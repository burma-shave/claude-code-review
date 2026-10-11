export const MAX_RECORD_BYTES = 1024 * 1024;
export const MAX_RESULT_BYTES = 512 * 1024;

export interface DecodedResult {
  text: string;
  isError: boolean;
  diagnostic: string | null;
}

/** Only classifies a discarded oversized envelope. Never extracts findings or buffers its body. */
class EnvelopeTypeScanner {
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private stage: 'key' | 'colon' | 'value' | 'comma' = 'key';
  private key: string | undefined;
  private role: 'key' | 'value' | undefined;
  private token = '';
  private tooLong = false;
  type: string | undefined;
  sawResult = false;

  push(bytes: Buffer): void {
    for (const byte of bytes) {
      if (this.quoted) {
        if (this.role && !this.tooLong) {
          if (this.token.length < 256) this.token += String.fromCharCode(byte);
          else { this.tooLong = true; this.token = ''; }
        }
        if (this.escaped) { this.escaped = false; continue; }
        if (byte === 92) { this.escaped = true; continue; }
        if (byte !== 34) continue;
        this.quoted = false;
        if (this.role) {
          let value: string | undefined;
          try { if (!this.tooLong) value = JSON.parse(this.token); } catch { /* classification remains unknown */ }
          if (this.role === 'key') { this.key = value; this.stage = 'colon'; }
          else {
            if (this.key === 'type') { this.type = value; this.sawResult ||= value === 'result'; }
            this.stage = 'comma';
          }
        }
        this.role = undefined;
        continue;
      }
      if (byte === 34) {
        this.quoted = true;
        this.escaped = false;
        this.role = this.depth === 1 && (this.stage === 'key' || this.stage === 'value') ? this.stage : undefined;
        this.token = this.role ? '"' : '';
        this.tooLong = false;
      } else if (byte === 123 || byte === 91) {
        if (this.depth === 1 && this.stage === 'value') this.stage = 'comma';
        this.depth++;
      } else if (byte === 125 || byte === 93) this.depth--;
      else if (this.depth === 1) {
        if (byte === 58) this.stage = 'value';
        else if (byte === 44) { this.stage = 'key'; this.key = undefined; }
        else if (![32, 9, 13].includes(byte) && this.stage === 'value') this.stage = 'comma';
      }
    }
  }
}

/** One fixed record buffer plus one bounded report; never retains the full event stream. */
export class ResultDecoder {
  private readonly buffer = Buffer.allocUnsafe(MAX_RECORD_BYTES);
  private size = 0;
  private discarding = false;
  private scanner = new EnvelopeTypeScanner();
  private resultCount = 0;
  private result: DecodedResult | undefined;
  private invalid = false;

  push(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline === -1 ? chunk.length : newline;
      const piece = chunk.subarray(offset, end);
      this.scanner.push(piece);
      if (!this.discarding) {
        if (this.size + piece.length > MAX_RECORD_BYTES) {
          this.size = 0;
          this.discarding = true;
        } else {
          piece.copy(this.buffer, this.size);
          this.size += piece.length;
        }
      }
      if (newline === -1) break;
      this.record();
      offset = newline + 1;
    }
  }

  private record(): void {
    if (this.discarding) {
      // Unknown envelopes fail conservatively; known non-result events can be skipped.
      if (this.scanner.sawResult || this.scanner.type === undefined) this.invalid = true;
    } else if (this.size) {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(this.buffer.subarray(0, this.size));
        const event: unknown = JSON.parse(text);
        if (event !== null && typeof event === 'object' && 'type' in event && event.type === 'result') {
          this.resultCount++;
          if (!('is_error' in event) || typeof event.is_error !== 'boolean' || !('subtype' in event) || typeof event.subtype !== 'string') {
            this.invalid = true;
          } else {
            const isError = event.is_error || event.subtype !== 'success';
            const resultText = 'result' in event && typeof event.result === 'string' ? event.result : '';
            const errors = 'errors' in event && Array.isArray(event.errors)
              ? event.errors.filter((item: unknown) => typeof item === 'string').join('\n') : '';
            const report = resultText || errors;
            if ((!resultText && !isError) || Buffer.byteLength(report) > MAX_RESULT_BYTES) this.invalid = true;
            else if (!this.result) this.result = { text: report, isError, diagnostic: isError ? errors || 'Claude reported a result-level error.' : null };
          }
        }
      } catch { this.invalid = true; }
    }
    this.size = 0;
    this.discarding = false;
    this.scanner = new EnvelopeTypeScanner();
  }

  finish(): DecodedResult {
    this.record();
    if (this.invalid || this.resultCount !== 1 || !this.result) {
      return { text: this.result?.text ?? '', isError: true, diagnostic: 'Claude stream protocol failure: missing, malformed, oversized, or duplicate final result. Inspect the raw output.' };
    }
    return this.result;
  }
}
