import { createWorkflow, SequenceNodeBuilder, } from '@jshookmcp/extension-sdk/workflow';
const workflowId = 'workflow.protocol-registry.v1';
export default createWorkflow(workflowId, 'Protocol Registry')
    .description('Automatically classifies all communication channels on a page: REST/GraphQL/gRPC endpoints, WebSocket connections, SSE streams, beacon/sendBeacon calls, and postMessage channels — producing a protocol registry with message formats and handler locations.')
    .tags(['reverse', 'protocol', 'api', 'websocket', 'sse', 'graphql', 'rest', 'mission'])
    .timeoutMs(10 * 60_000)
    .defaultMaxConcurrency(5)
    .buildGraph((ctx) => {
    const prefix = 'workflows.protocolRegistry';
    const url = String(ctx.getConfig(`${prefix}.url`, 'https://example.com'));
    const waitUntil = String(ctx.getConfig(`${prefix}.waitUntil`, 'networkidle0'));
    const captureDelay = Number(ctx.getConfig(`${prefix}.captureDelayMs`, 5000));
    const requestTail = Number(ctx.getConfig(`${prefix}.requestTail`, 100));
    const maxFrames = Number(ctx.getConfig(`${prefix}.maxFrames`, 100));
    const maxConcurrency = Number(ctx.getConfig(`${prefix}.parallel.maxConcurrency`, 5));
    const root = new SequenceNodeBuilder('protocol-registry-root');
    root
        // Phase 1: Enable Monitors
        .parallel('enable-monitors', (p) => {
        p.maxConcurrency(maxConcurrency)
            .failFast(false)
            .tool('enable-network', 'network_enable', { input: { enableExceptions: true } })
            .tool('enable-ws', 'ws_monitor_enable', { input: {} })
            .tool('enable-sse', 'sse_monitor_enable', { input: {} })
            .tool('enable-console', 'console_enable', { input: {} });
    })
        // Phase 2: Navigate & Wait
        .tool('navigate', 'page_navigate', { input: { url, waitUntil } })
        .tool('wait-activity', 'page_wait_for_timeout', { input: { timeout: captureDelay } })
        // Phase 3: Parallel Channel Collection
        .parallel('collect-channels', (p) => {
        p.maxConcurrency(maxConcurrency)
            .failFast(false)
            .tool('get-requests', 'network_get_requests', { input: { tail: requestTail } })
            .tool('get-ws-connections', 'ws_get_connections', { input: {} })
            .tool('get-ws-frames', 'ws_get_frames', { input: { limit: maxFrames } })
            .tool('get-sse-events', 'sse_get_events', { input: {} })
            .tool('search-fetch-xhr', 'search_in_scripts', {
            input: { query: 'fetch,XMLHttpRequest,sendBeacon,postMessage,EventSource,WebSocket', matchType: 'any' },
        })
            .tool('get-network-stats', 'network_get_stats', { input: {} });
    })
        // Phase 4: Protocol Classification
        .tool('classify-protocols', 'page_evaluate', {
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
    })
        // Phase 5: Handler Location
        .tool('locate-handlers', 'extract_function_tree', {
        input: { targetParam: 'addEventListener', depth: 2 },
    })
        // Phase 6: Evidence Recording
        .tool('create-evidence-session', 'instrumentation_session_create', {
        input: {
            name: `protocol-registry-${new Date().toISOString().slice(0, 10)}`,
            metadata: { url, workflowId },
        },
    })
        .tool('record-artifact', 'instrumentation_artifact_record', {
        input: {
            type: 'protocol_registry',
            label: `Protocol registry for ${url}`,
            metadata: { url, requestTail, maxFrames },
        },
    })
        // Phase 7: Session Insight
        .tool('emit-insight', 'append_session_insight', {
        input: {
            insight: JSON.stringify({
                status: 'protocol_registry_complete',
                workflowId,
                url,
                captureDelay,
            }),
        },
    });
    return root;
})
    .onStart((ctx) => {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', { workflowId, mission: 'protocol_registry', stage: 'start' });
})
    .onFinish((ctx) => {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', { workflowId, mission: 'protocol_registry', stage: 'finish' });
})
    .onError((ctx, error) => {
    ctx.emitMetric('workflow_errors_total', 1, 'counter', { workflowId, mission: 'protocol_registry', stage: 'error', error: error.name });
})
    .build();
