export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
}

export interface DocumentDetails {
  name: string; // The Gemini file name
  uri: string;
  mimeType: string;
  displayName: string;
}

export interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}
