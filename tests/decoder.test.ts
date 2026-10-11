import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MAX_RECORD_BYTES, MAX_RESULT_BYTES, ResultDecoder } from '../src/decoder.js';

const envelope = (result = 'No findings. é🙂', extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, result, ...extra });
const record = (value: unknown) => `${JSON.stringify(value)}\n`;
function decode(wire: string | Buffer, fragmentBytes = 16384) {
  const decoder = new ResultDecoder();
  const bytes = typeof wire === 'string' ? Buffer.from(wire) : wire;
  for (let offset = 0; offset < bytes.length; offset += fragmentBytes) decoder.push(bytes.subarray(offset, offset + fragmentBytes));
  return decoder.finish();
}

test('retained actual upstream findings envelope is returned as prose, not reconstructed findings', async () => {
  const captured = JSON.parse(await readFile(new URL('./fixtures/smoke-2.1.296-current-diff.json', import.meta.url), 'utf8'));
  const result = decode(record({ type: 'assistant', message: 'Intermediate text' }) + record(captured));
  assert.deepEqual(result, { text: captured.result, isError: false, diagnostic: null });
});

test('synthetic no-findings envelope is execution success, without finding-count inference', () => {
  assert.deepEqual(decode(record(envelope())), { text: 'No findings. é🙂', isError: false, diagnostic: null });
});

for (const fragmentBytes of [1, 2, 3, 7, 65536]) {
  test(`UTF-8 and record boundaries fragmented into ${fragmentBytes} bytes`, () => {
    const wire = record({ type: 'system', message: 'progress é🙂' }) + record(envelope('Finding on line 2: é🙂'));
    assert.deepEqual(decode(wire, fragmentBytes), { text: 'Finding on line 2: é🙂', isError: false, diagnostic: null });
  });
}

test('valid unterminated final record is accepted at EOF; CRLF records also work', () => {
  assert.equal(decode(JSON.stringify(envelope())).isError, false);
  assert.equal(decode(record(envelope()).replace('\n', '\r\n')).isError, false);
});

for (const value of [
  envelope('partial report', { is_error: true }),
  { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['API error', 'authentication failed'] },
  envelope('partial report', { subtype: 'error_max_turns', is_error: false }),
]) {
  test(`result-level failure despite potential exit zero: ${JSON.stringify(value)}`, () => {
    const result = decode(record(value));
    assert.equal(result.isError, true);
    assert.ok(result.diagnostic);
    assert.equal(result.text, 'result' in value ? value.result : value.errors.join('\n'));
  });
}

for (const [name, wire] of [
  ['missing', ''], ['intermediate only', record({ type: 'assistant', text: 'not a report' })],
  ['invalid JSON', '{not json}\n'], ['partial record', '{"type":"result","result":'],
  ['missing is_error', record({ type: 'result', subtype: 'success', result: 'text' })],
  ['missing subtype', record({ type: 'result', is_error: false, result: 'text' })],
  ['non-string report', record(envelope('text', { result: [] }))],
  ['empty success report', record(envelope(''))],
  ['duplicate result', record(envelope('first')) + record(envelope('second'))],
  ['malformed then valid', '{not json}\n' + record(envelope())],
  ['oversized result body', record(envelope('x'.repeat(MAX_RESULT_BYTES + 1)))],
  ['oversized result record', record(envelope('x'.repeat(MAX_RECORD_BYTES + 1)))],
  ['oversized result followed by valid', record(envelope('x'.repeat(MAX_RECORD_BYTES + 1))) + record(envelope())],
  ['oversized result with type last', record({ padding: 'x'.repeat(MAX_RECORD_BYTES + 1), ...envelope() }) + record(envelope())],
] as const) {
  test(`protocol failure: ${name}`, () => {
    const result = decode(wire);
    assert.equal(result.isError, true);
    assert.match(result.diagnostic!, /protocol failure/);
  });
}

test('partial report retained on duplicate or malformed subsequent results', () => {
  assert.equal(decode(record(envelope('first report')) + '{"type":"result", broken}\n').text, 'first report');
  assert.equal(decode(record(envelope('first report')) + record(envelope('second report'))).text, 'first report');
});

test('invalid UTF-8 is a protocol failure rather than silently replaced report text', () => {
  const prefix = Buffer.from('{"type":"result","subtype":"success","is_error":false,"result":"');
  const bytes = Buffer.concat([prefix, Buffer.from([0xff]), Buffer.from('"}\n')]);
  assert.match(decode(bytes).diagnostic!, /protocol failure/);
});

for (const intermediate of [
  { type: 'assistant', text: 'x'.repeat(MAX_RECORD_BYTES + 1) },
  { text: 'x'.repeat(MAX_RECORD_BYTES + 1), type: 'assistant' },
  { text: 'x'.repeat(MAX_RECORD_BYTES + 1), nested: { type: 'result' }, type: 'assistant' },
  { nested: [{ text: 'x'.repeat(MAX_RECORD_BYTES + 1), type: 'result' }], type: 'system' },
  { type: 'user', text: `${'x'.repeat(MAX_RECORD_BYTES + 1)} "type": "result"` },
]) {
  test(`oversized intermediate event with field order ${Object.keys(intermediate)} does not obscure final result`, () => {
    const result = decode(record(intermediate) + record(envelope('final report')), 8191);
    assert.deepEqual(result, { text: 'final report', isError: false, diagnostic: null });
  });
}

test('escaped top-level type key is recognized even in oversized records', () => {
  const oversized = `{"padding":"${'x'.repeat(MAX_RECORD_BYTES + 1)}","\\u0074ype":"result"}\n`;
  assert.match(decode(oversized + record(envelope())).diagnostic!, /protocol failure/);
});

test('result byte bound includes multibyte text, not just code units', () => {
  const text = 'é'.repeat(MAX_RESULT_BYTES / 2);
  assert.equal(decode(record(envelope(text))).text, text);
  assert.match(decode(record(envelope(text + 'é'))).diagnostic!, /protocol failure/);
});
