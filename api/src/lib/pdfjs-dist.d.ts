declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export interface PdfTextItem {
    str: string;
    transform: number[];
  }

  export interface PdfPageProxy {
    getTextContent(): Promise<{ items: PdfTextItem[] }>;
  }

  export interface PdfDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfPageProxy>;
  }

  export interface PdfLoadingTask {
    promise: Promise<PdfDocumentProxy>;
  }

  export function getDocument(options: {
    data: Uint8Array;
    disableFontFace?: boolean;
  }): PdfLoadingTask;
}
