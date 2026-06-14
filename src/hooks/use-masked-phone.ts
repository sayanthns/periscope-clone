"use client";

/**
 * Number masking (Periskope-style privacy).
 *
 * When the account has mask_numbers enabled, agents and viewers see
 * phone numbers with the middle digits hidden (+9199•••••210). Owners
 * and admins always see full numbers.
 */

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export function useMaskedPhone() {
  const { accountId, isOwner, isAdmin } = useAuth();
  const [maskEnabled, setMaskEnabled] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    supabase
      .from("accounts")
      .select("mask_numbers")
      .eq("id", accountId)
      .maybeSingle()
      .then(({ data }) => {
        setMaskEnabled(!!data?.mask_numbers);
      });
  }, [accountId]);

  const shouldMask = maskEnabled && !isOwner && !isAdmin;

  const maskPhone = useCallback(
    (phone: string | null | undefined): string => {
      if (!phone) return "";
      if (!shouldMask) return phone;
      // Group JIDs aren't personal numbers — leave them alone
      if (phone.includes("@")) return phone;
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 7) return "•••••";
      const prefix = phone.startsWith("+") ? "+" : "";
      return `${prefix}${digits.slice(0, 4)}${"•".repeat(Math.max(3, digits.length - 7))}${digits.slice(-3)}`;
    },
    [shouldMask],
  );

  return { maskPhone, shouldMask };
}
