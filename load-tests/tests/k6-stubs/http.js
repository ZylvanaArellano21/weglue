export const calls = [];
export default {
  batch(requests) {
    calls.push(...requests);
    return requests.map(() => ({ status: 200, error_code: 0 }));
  },
};
