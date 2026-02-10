export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  question: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface QuestionAction {
  type: 'question';
  questions: QuestionItem[];
}
