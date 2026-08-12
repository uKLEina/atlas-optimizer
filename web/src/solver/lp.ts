/**
 * CPLEX LP 形式テキストのビルダー。
 *
 * pyref は highspy のプログラム的 API(addVars/addRow)でモデルを組むが、
 * highs-js の入力は LP 形式テキストのみのため、ここで生成する。
 * 変数名は数字始まりが許されないことに注意(呼び出し側で y_/x_/f_ を接頭する)。
 */

export type LpTerm = readonly [coef: number, name: string];

export interface LpConstraint {
  terms: readonly LpTerm[];
  sense: "<=" | ">=" | "=";
  rhs: number;
}

const TERMS_PER_LINE = 12; // 1行が長くなりすぎないよう折り返す(LP形式は式の途中改行可)

export function formatTerms(terms: readonly LpTerm[]): string {
  const parts: string[] = [];
  terms.forEach(([coef, name], i) => {
    const sign = coef < 0 ? "-" : i === 0 ? "" : "+";
    const mag = Math.abs(coef);
    const coefStr = mag === 1 ? "" : `${mag} `;
    const sep = i > 0 && i % TERMS_PER_LINE === 0 ? "\n " : i === 0 ? "" : " ";
    parts.push(`${sep}${sign}${sign ? " " : ""}${coefStr}${name}`);
  });
  return parts.join("");
}

export function buildLp(
  objective: readonly LpTerm[],
  constraints: readonly LpConstraint[],
  bounds: readonly string[],
  generals: readonly string[],
): string {
  const lines: string[] = ["Minimize", ` obj: ${formatTerms(objective)}`, "Subject To"];
  constraints.forEach((c, i) => {
    lines.push(` c${i}: ${formatTerms(c.terms)} ${c.sense} ${c.rhs}`);
  });
  lines.push("Bounds", ...bounds, "General");
  for (let i = 0; i < generals.length; i += TERMS_PER_LINE) {
    lines.push(` ${generals.slice(i, i + TERMS_PER_LINE).join(" ")}`);
  }
  lines.push("End", "");
  return lines.join("\n");
}
