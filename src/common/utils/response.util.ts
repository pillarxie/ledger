/**
 * 分页响应构造器
 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMeta;
}

export function createPaginatedResponse<T>(
  items: T[],
  page: number,
  pageSize: number,
  total: number,
): PaginatedResponse<T> {
  // 防御非法入参（pageSize=0 会导致除零）
  const safePage = Math.max(page, 1);
  const safePageSize = Math.max(pageSize, 1);

  return {
    items,
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.ceil(total / safePageSize),
    },
  };
}
