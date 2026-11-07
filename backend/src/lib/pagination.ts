import { z } from "zod";

const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(20),
});

export interface Paging {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function parsePaging(params: URLSearchParams): Paging {
  const { page, pageSize } = pagingSchema.parse({
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
  });
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function paginated<T>(data: T[], total: number, paging: Paging) {
  return { data, page: paging.page, pageSize: paging.pageSize, total };
}
