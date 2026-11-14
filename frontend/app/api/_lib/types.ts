export type SchemaTable = {
  table: string;
  columns: { name: string; type: string }[];
  row_count: number;
};

export type Dataset = {
  id: string;
  connection_id: string;
  name: string;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  tables: SchemaTable[];
  preview: Record<string, unknown>[];
  duplicate_rows: number;
  potential_primary_keys: Record<string, string[]>;
};

export type Intent = {
  request?: string;
  operation?: string;
  metric?: string;
  dimensions?: string[];
  filters?: Record<string, string>;
  time_range?: string | null;
  missing_information?: string[];
  ranking?: Record<string, unknown>;
};
