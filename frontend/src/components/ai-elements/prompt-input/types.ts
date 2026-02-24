import type { Ref } from 'vue'

export interface FileAttachment {
  type: 'file'
  url: string
  mediaType: string
  filename: string
}

export interface PromptInputMessage {
  text: string
  files: FileAttachment[]
}

export interface AttachmentFile extends FileAttachment {
  id: string
  file?: File
}

export interface PromptInputContext {
  textInput: Ref<string>
  files: Ref<AttachmentFile[]>
  isLoading: Ref<boolean>
  fileInputRef: Ref<HTMLInputElement | null>
  setTextInput: (val: string) => void
  addFiles: (files: File[] | FileList) => void
  removeFile: (id: string) => void
  clearFiles: () => void
  clearInput: () => void
  openFileDialog: () => void
  submitForm: () => void
}

export const PROMPT_INPUT_KEY = Symbol('PromptInputContext')
