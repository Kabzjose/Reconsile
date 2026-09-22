"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Order } from "@/lib/types";
import { Field, inputClass } from "@/components/Field";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Modal } from "@/components/Modal";

export function NewOrderDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (order: Order) => void }) {
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountCents = Math.round(Number(amount) * 100);
    if (!reference.trim() || !Number.isFinite(amountCents) || amountCents <= 0) {
      setError("Enter a reference and an amount greater than zero.");
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<{ data: Order }>("/api/orders", {
        reference,
        amountCents,
        description: description || undefined,
        customerId: undefined,
        ...(customerName ? { customer: { name: customerName, phone: customerPhone || undefined } } : {}),
      });
      onCreated(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the order.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="New order" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? <Notice tone="red">{error}</Notice> : null}
        <Field label="Reference" hint="What the payer will quote as the account number">
          <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ORD-1010" autoFocus />
        </Field>
        <Field label="Amount (KSh)">
          <input className={inputClass} type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2500" />
        </Field>
        <Field label="Description (optional)">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="2 bags of cement" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer name (optional)">
            <input className={inputClass} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in" />
          </Field>
          <Field label="Phone (optional)" hint="Helps the matching engine">
            <input className={inputClass} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="0712 345 678" />
          </Field>
        </div>
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            Create order
          </Button>
        </div>
      </form>
    </Modal>
  );
}
