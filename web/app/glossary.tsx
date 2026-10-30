import { PAYING_SHARE_OF_MEAN, SPIKE_RATIO, STEADY_BUCKET_HOURS } from "@/lib/fee-history";
import { SOLID_FROM_HOURS, THIN_UNDER_HOURS } from "@/lib/gauge-yield";
import { NOTE } from "./ui";

/** The table's words in plain English. The numbers come from the same constants the code uses, so the text can't drift from the logic. */
export function glossaryTerms(flowHours?: number): Array<{ term: string; meaning: string }> {
  return [
    {
      term: "You earn / day",
      meaning: "What your amount would make per day in that gauge alone, after it joins the power already there.",
    },
    {
      term: "Power, share of weight",
      meaning:
        "Power is the voting power of sAERO. Share of weight is how much of the gauge's power would be yours; the more power a gauge holds, the less each unit of it earns.",
    },
    {
      term: "thin, fair, solid pace",
      meaning: `How much fee history the daily figure rests on: thin is under ${THIN_UNDER_HOURS} hours, fair is ${THIN_UNDER_HOURS} to ${SOLID_FROM_HOURS} hours, solid is a day or more. A thin figure can swing a lot.`,
    },
    {
      term: "spiky",
      meaning: `The recent fees are at least ${SPIKE_RATIO} times the gauge's usual level, so it is probably a one-off burst. The range shows the usual level as the low end.`,
    },
    {
      term: "steady 5/6",
      meaning: `The gauge's recent fees are counted in complete half-days (${STEADY_BUCKET_HOURS} hours each). 5/6 means 5 of its 6 half-days paid at least ${Math.round(PAYING_SHARE_OF_MEAN * 100)}% of the average one. 6/6 means the fees came in steadily; a low number means they come in lumps.`,
    },
    {
      term: "incentives, incentives (ending)",
      meaning:
        "The gauge is paid mostly by incentives, which stream at a fixed rate until their program ends. “ending” means some of them stop inside the wait. A program can be renewed, but nothing promises it.",
    },
    {
      term: "Power flow",
      meaning: `How a gauge's share of all the power on the chain changed over the last ${flowHours ? Math.round(flowHours) : 24} hours. A gauge that is filling up earns less per unit. It shows where power went, not where it will go.`,
    },
    {
      term: "CL100, volatile, stable",
      meaning:
        "The pool type. CL and a number is a concentrated-liquidity pool: the number is its tick spacing (small for pairs that move together, larger for volatile ones) and the percent next to it is its current fee. Volatile and stable are the classic pools.",
    },
  ];
}

export function Glossary({ flowHours }: { flowHours?: number }) {
  return (
    <details className="mt-4 rounded-lg border border-neutral-800 px-3 py-2">
      <summary className="cursor-pointer select-none text-sm text-neutral-300">What do these words mean?</summary>
      <dl className="mt-2 space-y-2">
        {glossaryTerms(flowHours).map((g) => (
          <div key={g.term}>
            <dt className="text-sm font-medium text-neutral-100">{g.term}</dt>
            <dd className={`mt-0.5 ${NOTE}`}>{g.meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
