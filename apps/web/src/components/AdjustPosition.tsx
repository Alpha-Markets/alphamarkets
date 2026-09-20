"use client";

import { Button, TextField } from "@orionis/ui";
import { toBaseUnits } from "@orionis/sdk";
import type { PerpPosition } from "@orionis/types";
import { useState } from "react";
import { useWalletOrionis } from "@/hooks/useOrionis";
import { useTx } from "@/hooks/useTx";
import { fmtUsd } from "@/lib/format";
import { perpLabel } from "@/lib/market";

const isAmount = (value: string) => /^\d+(\.\d+)?$/.test(value) && Number(value) > 0;

/// Increase or reduce an open perp position. The size is the notional change in settlement-token
/// units; the contract enforces leverage tiers and margin, so this only checks the input shape and
/// that a reduction does not exceed the position.
export function AdjustPosition({ position, decimals }: { position: PerpPosition; decimals: number }) {
  const wallet = useWalletOrionis();
  const run = useTx();
  const [size, setSize] = useState("");
  const [collateral, setCollateral] = useState("");

  const validSize = isAmount(size);
  const validCollateral = collateral === "" || isAmount(collateral);
  const sizeBase = validSize ? toBaseUnits(size, decimals) : 0n;
  const tooLarge = validSize && sizeBase >= position.size;
  const label = perpLabel(position.marketId);

  return (
    <div className="flex flex-wrap items-end gap-3 p-3">
      <TextField
        label="Size change"
        className="w-44"
        value={size}
        placeholder="0.00"
        suffix="USD"
        invalid={size !== "" && !validSize}
        hint={`of ${fmtUsd(position.size, decimals, 0)}`}
        onValueChange={setSize}
      />
      <TextField
        label="Add margin (increase only)"
        className="w-52"
        value={collateral}
        placeholder="0.00"
        suffix="USD"
        invalid={!validCollateral}
        onValueChange={setCollateral}
      />
      <Button
        disabled={!wallet || !validSize || !validCollateral}
        onClick={() =>
          run({ title: "Increase position", summary: `${label} · +${size}` }, (tx) =>
            wallet!.perps.increasePosition(position.positionId, {
              addSize: toBaseUnits(size, decimals),
              addCollateral: collateral === "" ? undefined : toBaseUnits(collateral, decimals),
              tx,
            }),
          )
        }
      >
        Increase
      </Button>
      <Button
        disabled={!wallet || !validSize || tooLarge}
        title={tooLarge ? "To reduce by the full size, close the position." : undefined}
        onClick={() =>
          run({ title: "Reduce position", summary: `${label} · −${size}` }, (tx) =>
            wallet!.perps.reducePosition(position.positionId, { size: toBaseUnits(size, decimals), tx }),
          )
        }
      >
        Reduce
      </Button>
    </div>
  );
}
