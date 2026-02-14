// ============================================
// RegisterTable — Reusable TanStack Table wrapper
// Used for CD Register, RP Log, Returns
// ============================================

import { useState, useEffect, type ReactNode } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type PaginationState,
} from '@tanstack/react-table'

interface RegisterTableProps<T> {
  data: T[]
  columns: ColumnDef<T, unknown>[]
  loading?: boolean
  emptyMessage?: string
  pageSize?: number
  globalFilter?: string
  onGlobalFilterChange?: (value: string) => void
  /** Optional inline footer row rendered inside <tfoot> */
  footerRow?: ReactNode
  /** Optional callback to add extra CSS classes per row */
  rowClassName?: (row: T) => string | undefined
  /** When true, always show pagination controls even on single page */
  alwaysShowPagination?: boolean
  /** ID used for print targeting */
  printId?: string
}

export function RegisterTable<T>({
  data,
  columns,
  loading = false,
  emptyMessage = 'No entries found.',
  pageSize = 50,
  globalFilter,
  onGlobalFilterChange,
  footerRow,
  rowClassName,
  alwaysShowPagination = false,
  printId,
}: RegisterTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  })

  // Sync pageSize prop with internal pagination state and reset to page 1
  useEffect(() => {
    setPagination((prev) => ({ ...prev, pageSize, pageIndex: 0 }))
  }, [pageSize])

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  if (loading) {
    return (
      <div className="register-table-loading">
        <div className="loading-spinner" />
        <p>Loading entries...</p>
      </div>
    )
  }

  return (
    <div className="register-table-wrapper" id={printId}>
      <div className="register-table-scroll">
        <table className="register-table">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={header.column.getCanSort() ? 'sortable' : ''}
                    onClick={header.column.getToggleSortingHandler()}
                    style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                  >
                    <div className="th-content">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' && ' ▲'}
                      {header.column.getIsSorted() === 'desc' && ' ▼'}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="empty-row">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const extraClass = rowClassName ? rowClassName(row.original) : ''
                return (
                <tr key={row.id} className={`${row.index % 2 === 0 ? 'even' : 'odd'} ${extraClass ?? ''}`}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              )})
            )}
          </tbody>

          {footerRow && (
            <tfoot className="register-table-footer">
              {footerRow}
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination */}
      {(alwaysShowPagination || table.getPageCount() > 1) && (
        <div className="register-table-pagination no-print">
          <div className="pagination-info">
            Showing {table.getFilteredRowModel().rows.length === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1}–
            {Math.min(
              (pagination.pageIndex + 1) * pagination.pageSize,
              table.getFilteredRowModel().rows.length,
            )}{' '}
            of {table.getFilteredRowModel().rows.length} entries
          </div>
          <div className="pagination-controls">
            <button
              className="ps-btn ps-btn-ghost"
              onClick={() => table.firstPage()}
              disabled={!table.getCanPreviousPage()}
            >
              ⏮
            </button>
            <button
              className="ps-btn ps-btn-ghost"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              ◀
            </button>
            <span className="pagination-page">
              Page {pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
            </span>
            <button
              className="ps-btn ps-btn-ghost"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              ▶
            </button>
            <button
              className="ps-btn ps-btn-ghost"
              onClick={() => table.lastPage()}
              disabled={!table.getCanNextPage()}
            >
              ⏭
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
