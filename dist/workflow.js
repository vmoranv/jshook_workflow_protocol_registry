function toolNode(id, toolName, options) {
  return {
    kind: 'tool',
    id,
    toolName,
    input: options?.input,
    retry: options?.retry,
    timeoutMs: options?.timeoutMs,
  };
}
function sequenceNode(id, steps) {
  return { kind: 'sequence', id, steps };
}
function parallelNode(id, steps, maxConcurrency, failFast) {
  return { kind: 'parallel', id, steps, maxConcurrency, failFast };
}

const workflowId = 'workflow.protocol-registry.v1';

const protocolRegistryWorkflow = {
  kind: 'workflow-contract',
  version: 1,
  id: workflowId,
  displayName: 'Protocol Registry',
  description:
    'Automatically classifies all communication channels on a page: REST/GraphQL/gRPC endpoints, WebSocket connections, SSE streams, beacon/sendBeacon calls, and postMessage channels — producing a protocol registry with message formats and handler locations.',
  tags: ['reverse', 'protocol', 'api', 'websocket', 'sse', 'graphql', 'rest', 'mission'],
  timeoutMs: 10 * 60_000,
  defaultMaxConcurrency: 5,

  build(ctx) {
    const prefix = 'workflows.protocolRegistry';
    const url = String(ctx.getConfig(`${prefix}.url`, 'https://example.com'));
    const waitUntil = String(ctx.getConfig(`${prefix}.waitUntil`, 'networkidle0'));
    const captureDelay = Number(ctx.getConfig(`${prefix}.captureDelayMs`, 5000));
    const requestTail = Number(ctx.getConfig(`${prefix}.requestTail`, 100));
    const maxFrames = Number(ctx.getConfig(`${prefix}.maxFrames`, 100));
    const maxConcurrency = Number(ctx.getConfig(`${prefix}.parallel.maxConcurrency`, 5));

    return sequenceNode('protocol-registry-root', [
      // Phase 1: Enable Monitors
      parallelNode(
        'enable-monitors',
        [
          toolNode('enable-network', 'network_enable', { input: { enableExceptions: true } }),
          toolNode('enable-ws', 'ws_monitor_enable', { input: {} }),
          toolNode('enable-sse', 'sse_monitor_enable', { input: {} }),
          toolNode('enable-console', 'console_enable', { input: {} }),
        ],
        maxConcurrency,
        false,
      ),

      // Phase 2: Navigate & Wait
      toolNode('navigate', 'page_navigate', { input: { url, waitUntil } }),
      toolNode('wait-activity', 'page_wait_for_timeout', { input: { timeout: captureDelay } }),

      // Phase 3: Parallel Channel Collection
      parallelNode(
        'collect-channels',
        [
          toolNode('get-requests', 'network_get_requests', { input: { tail: requestTail } }),
          toolNode('get-ws-connections', 'ws_get_connections', { input: {} }),
          toolNode('get-ws-frames', 'ws_get_frames', { input: { limit: maxFrames } }),
          toolNode('get-sse-events', 'sse_get_events', { input: {} }),
          toolNode('search-fetch-xhr', 'search_in_scripts', {
            input: { query: 'fetch,XMLHttpRequest,sendBeacon,postMessage,EventSource,WebSocket', matchType: 'any' },
          }),
          toolNode('get-network-stats', 'network_get_stats', { input: {} }),
        ],
        maxConcurrency,
        false,
      ),

      // Phase 4: Protocol Classification
      toolNode('classify-protocols', 'page_evaluate', {
        input: {
          expression: `(function() {
            const channels = {};
            channels.hasWebSocket = typeof WebSocket !== 'undefined';
            channels.hasEventSource = typeof EventSource !== 'undefined';
            channels.hasFetch = typeof fetch !== 'undefined';
            channels.hasXHR = typeof XMLHttpRequest !== 'undefined';
            channels.hasSendBeacon = typeof navigator.sendBeacon !== 'undefined';
            channels.serviceWorkerActive = !!navigator.serviceWorker?.controller;
            return channels;
          })()`,
        },
      }),

      // Phase 5: Handler Location
      toolNode('locate-handlers', 'extract_function_tree', {
        input: { targetParam: 'addEventListener', depth: 2 },
      }),

      // Phase 6: Evidence Recording
      toolNode('create-evidence-session', 'instrumentation_session_create', {
        input: {
          name: `protocol-registry-${new Date().toISOString().slice(0, 10)}`,
          metadata: { url, workflowId },
        },
      }),
      toolNode('record-artifact', 'instrumentation_artifact_record', {
        input: {
          type: 'protocol_registry',
          label: `Protocol registry for ${url}`,
          metadata: { url, requestTail, maxFrames },
        },
      }),

      // Phase 7: Session Insight
      toolNode('emit-insight', 'append_session_insight', {
        input: {
          insight: JSON.stringify({
            status: 'protocol_registry_complete',
            workflowId,
            url,
            captureDelay,
          }),
        },
      }),
    ]);
  },

  onStart(ctx) {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', { workflowId, mission: 'protocol_registry', stage: 'start' });
  },
  onFinish(ctx) {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', { workflowId, mission: 'protocol_registry', stage: 'finish' });
  },
  onError(ctx, error) {
    ctx.emitMetric('workflow_errors_total', 1, 'counter', { workflowId, mission: 'protocol_registry', stage: 'error', error: error.name });
  },
};

export default protocolRegistryWorkflow;
