/** Parses a decimal amount the user typed into the token's smallest unit. */
export function toRaw(value: string, decimals: number) {
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)?(?:\.\d+)?$/.test(text) || text === "" || text === ".")
    throw new Error("Enter a valid amount.");
  const [whole = "0", fraction = ""] = text.split(".");
  if (fraction.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  const raw =
    BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (raw <= 0n) throw new Error("Enter an amount above zero.");
  return raw;
}

/** Formats a raw token amount without losing precision. */
export function fromRaw(raw: bigint | string, decimals: number) {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${value / scale}.${fraction}` : String(value / scale);
}
