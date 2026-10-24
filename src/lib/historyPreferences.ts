const KEY='nyamuru.history-steps.v1';
export const DEFAULT_HISTORY_STEPS=50;
export function normalizeHistorySteps(value:unknown):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>1000)throw new Error('履歴の保持数は1〜1000の整数で指定してください');
  return value;
}
export function loadHistorySteps(storage?:Pick<Storage,'getItem'>):number {
  try {const raw=storage?.getItem(KEY);return raw==null?DEFAULT_HISTORY_STEPS:normalizeHistorySteps(JSON.parse(raw));}catch{return DEFAULT_HISTORY_STEPS;}
}
export function saveHistorySteps(storage:Pick<Storage,'setItem'>,value:number):number {
  const steps=normalizeHistorySteps(value);storage.setItem(KEY,String(steps));return steps;
}
