// Every payment provider (Daraja, card processors, bank, other mobile money) implements this adapter.
export interface CollectRequest { transactionId: string; amountMinor: number; currency: string; phone?: string; reference: string; description: string; }
export interface CollectResult { providerCheckoutId: string; }
export interface PaymentProvider {
  code: string; supportedCurrencies: string[];
  collect(req: CollectRequest): Promise<CollectResult>;   // initiates only; success is NEVER returned here
}
