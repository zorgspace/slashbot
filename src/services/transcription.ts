/**
 * Audio Transcription Service
 * Uses OpenAI Whisper API for speech-to-text
 */

import { c } from '../ui/colors';

export interface TranscriptionResult {
  text: string;
  duration?: number;
}

export class TranscriptionService {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.openai.com/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  /**
   * Transcribe audio from a URL
   */
  async transcribeFromUrl(audioUrl: string): Promise<TranscriptionResult | null> {
    try {
      // Download audio file
      const response = await fetch(audioUrl);
      if (!response.ok) {
        console.log(c.error(`Failed to download audio: ${response.status}`));
        return null;
      }

      const audioBuffer = await response.arrayBuffer();
      return await this.transcribe(audioBuffer, 'audio.ogg');
    } catch (error) {
      console.log(c.error(`Transcription error: ${error}`));
      return null;
    }
  }

  /**
   * Transcribe audio from buffer
   */
  async transcribe(audioData: ArrayBuffer, filename: string): Promise<TranscriptionResult | null> {
    try {
      const formData = new FormData();
      const blob = new Blob([audioData], { type: 'audio/ogg' });
      formData.append('file', blob, filename);
      formData.append('model', 'whisper-1');

      const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        console.log(c.error(`Whisper API error: ${response.status} - ${error}`));
        return null;
      }

      const data = await response.json();
      return {
        text: data.text || '',
        duration: data.duration,
      };
    } catch (error) {
      console.log(c.error(`Transcription error: ${error}`));
      return null;
    }
  }
}

let transcriptionService: TranscriptionService | null = null;

export function initTranscription(apiKey: string): TranscriptionService {
  transcriptionService = new TranscriptionService(apiKey);
  return transcriptionService;
}

export function getTranscriptionService(): TranscriptionService | null {
  return transcriptionService;
}
