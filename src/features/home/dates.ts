/** Date labels in the style of Nintendo's release pages: 11.19（四）. */
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const noon = (date: string) => Date.parse(`${date}T12:00:00Z`);

export const weekday = (date: string) => WEEKDAYS[new Date(noon(date)).getUTCDay()];
export const dotDate = (date: string) => `${date.slice(5, 7)}.${date.slice(8, 10)}（${weekday(date)}）`;
export const longDate = (date: string) => `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日（${weekday(date)}）`;
export const daysBetween = (from: string, to: string) => Math.round((noon(to) - noon(from)) / 86400000);
export const addDays = (date: string, days: number) => new Date(noon(date) + days * 86400000).toISOString().slice(0, 10);
/** Sunday that starts the week holding date, matching the calendar's first column. */
export const weekStart = (date: string) => addDays(date, -new Date(noon(date)).getUTCDay());
