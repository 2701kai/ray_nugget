export type LeadReceipt = {
  leadId: string;
  receiptId: string;
  sourceFingerprint: string;
  sourceRevision: number;
  receivedAt: string;
  receivedBy: string;
  state: 'received';
  crmState: 'not_connected';
  ownerEmail: string;
  ownerVersion: number;
  ownerAssignedAt: string;
  ownerAssignedBy: string;
};
