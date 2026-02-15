/**
 * TranscriptionProvider — interface for audio-to-text transcription backends.
 *
 * Plugins can register alternative implementations (local whisper.cpp,
 * Google Cloud STT, Azure Speech, etc.) by providing a class that
 * satisfies this interface and registering it as the
 * `transcription.service` service.
 */
export interface TranscriptionProvider {
  transcribe(buffer: Buffer, filename?: string): Promise<{ text: string }>;
  transcribeFromUrl(url: string): Promise<{ text: string }>;
}

/**
 * OpenAIWhisperTranscription — OpenAI Whisper API client.
 *
 * Uses the `whisper-1` model via the OpenAI Audio Transcriptions API.
 * Default implementation of TranscriptionProvider.
 */
export class OpenAIWhisperTranscription implements TranscriptionProvider {
  constructor(private readonly apiKey: string) {}

  async transcribe(buffer: Buffer, filename = 'audio.ogg'): Promise<{ text: string }> {
    const formData = new FormData();
    formData.append('model', 'whisper-1');
    formData.append('file', new Blob([new Uint8Array(buffer)]), filename);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Whisper API error ${response.status}: ${errorBody}`);
    }

    const result = (await response.json()) as { text: string };
    return { text: result.text };
  }

  async transcribeFromUrl(url: string): Promise<{ text: string }> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download audio from ${url}: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const ext = url.split('.').pop()?.split('?')[0] ?? 'ogg';
    return this.transcribe(buffer, `audio.${ext}`);
  }
}

/** @deprecated Use OpenAIWhisperTranscription instead */
export const TranscriptionService = OpenAIWhisperTranscription;
/** @deprecated Use TranscriptionProvider instead */
export type TranscriptionService = TranscriptionProvider;
