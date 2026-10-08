import { JOBS, ACTION_REFRESH } from "./primitives.js";
export function createSchedulerState() {
return { disposed:false, queue: null, queueSource: "", queueFetched: 0, runs: [], repoChecks: {}, repoErrors: {}, growth: null, content: null, twitch: null, igdb: null, busy: false };
}
export function freshRepositories(state) {
return Object.fromEntries([...new Set(JOBS.map(j => j.repo))].map(repo => [repo, !state.repoErrors[repo] && Date.now() - (state.repoChecks[repo] || 0) <= ACTION_REFRESH + 30000]));
}
