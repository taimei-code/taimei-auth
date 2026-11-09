export const setListIfLoading = <Model extends Readonly<{ visit: number; list: unknown }>>(
  model: Model,
  visit: number,
  list: Model["list"],
  isLoading: (list: Model["list"]) => boolean,
): Readonly<{ model: Model }> =>
  visit === model.visit && isLoading(model.list) ? { model: { ...model, list } } : { model };
