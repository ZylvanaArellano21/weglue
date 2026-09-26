export const state = { vu: 1, iteration: 0 };
export default {
  scenario: { startTime: Date.now() - 125_000 },
  get vu() {
    return { idInTest: state.vu, iterationInScenario: state.iteration };
  },
};
