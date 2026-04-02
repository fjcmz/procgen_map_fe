export interface ReferenceDescriptor {
  readonly typeName: string;
  readonly cardinality: number;
}

export class HistoryRoot {
  static readonly INSTANCE = new HistoryRoot();
  static readonly WORLD_REF: ReferenceDescriptor = { typeName: 'World', cardinality: 1 };
  static readonly TIMELINE_REF: ReferenceDescriptor = { typeName: 'Timeline', cardinality: 1 };

  private constructor() {}

  references(): ReferenceDescriptor[] {
    return [HistoryRoot.WORLD_REF, HistoryRoot.TIMELINE_REF];
  }
}
