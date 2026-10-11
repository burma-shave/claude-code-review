// Test-only offline model. Never connects to a service or loads credentials.
import { appendFileSync, readFileSync } from 'node:fs';
import { createAssistantMessageEventStream, getCurrentTools, getCurrentSystemPrompt } from '@earendil-works/pi-ai';

export default function (pi) {
  const plan = JSON.parse(readFileSync(process.env.REVIEW_TEST_PLAN, 'utf8'));
  const report = process.env.REVIEW_TEST_REPORT;
  let index = 0;
  let timer;
  const record = value => appendFileSync(report, JSON.stringify(value) + '\n');
  pi.on('session_start', (_event, ctx) => record({ kind: 'mode', mode: ctx.mode }));
  pi.on('tool_execution_start', (event, ctx) => {
    if (plan[index - 1]?.cancel) timer = setTimeout(() => ctx.abort(), 500);
  });
  pi.on('tool_execution_end', event => {
    if (timer) clearTimeout(timer);
    record({ kind: 'result', ...event });
  });
  pi.on('agent_end', (_event, ctx) => {
    record({ kind: 'end' });
    if (ctx.mode === 'tui') ctx.shutdown();
  });
  pi.on('session_shutdown', () => { if (timer) clearTimeout(timer); });
  pi.registerProvider('review-fixture', {
    api: 'review-fixture-api', apiKey: 'fake-local-key', baseUrl: 'http://invalid.local',
    models: [{ id: 'local', name: 'Local acceptance fixture', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 1024 }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const output = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: [], stopReason: 'pending', timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      queueMicrotask(() => {
        const tools = getCurrentTools(context.messages);
        record({ kind: 'discovery', tool: tools.some(tool => tool.name === 'claude_code_review'),
          skill: getCurrentSystemPrompt(context.messages).includes('claude-code-review') });
        stream.push({ type: 'start', partial: output });
        if (options?.signal?.aborted) {
          output.stopReason = 'aborted'; output.errorMessage = 'Cancelled fixture';
          stream.push({ type: 'error', reason: 'aborted', error: output });
        } else if (index < plan.length) {
          const call = { type: 'toolCall', id: `fixture-${index}`, name: 'claude_code_review', arguments: plan[index++].input };
          output.content.push(call);
          stream.push({ type: 'toolcall_start', contentIndex: 0, partial: output });
          stream.push({ type: 'toolcall_delta', contentIndex: 0, delta: JSON.stringify(call.arguments), partial: output });
          stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall: call, partial: output });
          output.stopReason = 'toolUse';
          stream.push({ type: 'done', reason: 'toolUse', message: output });
        } else {
          output.content.push({ type: 'text', text: 'Offline adapter acceptance complete.' });
          stream.push({ type: 'text_start', contentIndex: 0, partial: output });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: output.content[0].text, partial: output });
          stream.push({ type: 'text_end', contentIndex: 0, content: output.content[0].text, partial: output });
          output.stopReason = 'stop';
          stream.push({ type: 'done', reason: 'stop', message: output });
        }
        stream.end();
      });
      return stream;
    },
  });
}
