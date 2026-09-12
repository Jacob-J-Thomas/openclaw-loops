// Transport envelopes are separate from a loop's execution budget. Operators
// can change these defaults at plugin construction; persisted v1 runs retain
// their historical limits until explicitly revised to v2.
export const defaultBudgets={definitionBytes:4*1024*1024,inputBytes:1024*1024,promptBytes:1024*1024,defaultOutputBytes:1024*1024,defaultExecutions:1000,defaultRepeat:3};
export const legacyBudgets={definitionBytes:64000,inputBytes:16000,promptBytes:20000};
