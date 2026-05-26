export interface AppConfig {
  geminiApiKey: string;
  geminiModel?: string;
  googleClientId: string;
  googleSheetId?: string;
  googleDriveFolderId?: string;
  analysisMode?: boolean;
}

export interface TicketData {
  timestamp?: string;
  purchaseDate: string;
  category: string;
  storeName: string;
  amount: number;
  paymentMethod: string;
  paymentDetail: string;
  paymentAccount: string;
  driveLink?: string;
  description: string;
  txnId?: string;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
}

export interface QueueItem {
  id: string;
  photo: string;
  dateTaken: string;
}
