type LoadingListModel = Readonly<{ visit: number; list: Readonly<{ _tag: string }> }>;

export const setListIfLoading = <Model extends LoadingListModel>(
  model: Model,
  visit: number,
  list: Model["list"],
): Readonly<{ model: Model }> =>
  visit === model.visit && model.list._tag === "Loading"
    ? { model: { ...model, list } }
    : { model };
