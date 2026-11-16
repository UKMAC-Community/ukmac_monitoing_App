/**
 * How long the n-th tile of a board waits before it rises in: 45 ms after the one before it, for at most `steps` of them.
 * It is written as the tile's `--enter`, which what counts up inside it (CountUp) waits for too, so a number is seen
 * counting from its start, not already half way when its tile has come up.
 */
export const enterDelay = (index: number, steps = 8) => `${Math.min(Math.max(index, 0), steps) * 45}ms`;
