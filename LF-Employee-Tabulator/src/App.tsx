import { useEffect, useRef, useState } from 'react'
import { TabulatorFull as Tabulator } from 'tabulator-tables'
import type { CellComponent, ColumnDefinition, RowComponent } from 'tabulator-tables'
import 'tabulator-tables/dist/css/tabulator.min.css'
import './App.css'

type EmployeeRow = Record<string, unknown> & {
  __lfRowId: string
  __lfLocked: boolean
}

type ChangeSet = {
  type: 'employee-tabulator:save'
  added: Record<string, unknown>[]
  updated: Record<string, unknown>[]
  deleted: Record<string, unknown>[]
}

const INTERNAL_PREFIX = '__lf'

function normalizeColumns(columns: unknown[]): ColumnDefinition[] {
  return columns.flatMap((column) => {
    if (typeof column === 'string') {
      return [{ title: column, field: column }]
    }

    if (column && typeof column === 'object' && 'field' in column) {
      return [column as ColumnDefinition]
    }

    return []
  })
}

function toPublicRow(row: EmployeeRow): Record<string, unknown> {
  return {
    ...Object.fromEntries(
    Object.entries(row).filter(([key]) => !key.startsWith(INTERNAL_PREFIX)),
    ),
    locked: row.__lfLocked,
  }
}

function App() {
  const tableElement = useRef<HTMLDivElement>(null)
  const table = useRef<Tabulator | null>(null)
  const targetOrigin = useRef('*')
  const addedRows = useRef(new Map<string, EmployeeRow>())
  const updatedRows = useRef(new Map<string, EmployeeRow>())
  const deletedRows = useRef(new Map<string, Record<string, unknown>>())
  const [columns, setColumns] = useState<ColumnDefinition[]>([])
  const [rows, setRows] = useState<EmployeeRow[]>([])
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('Waiting for employee data from Laserfiche')
  const [changeCount, setChangeCount] = useState(0)
  const [rowCount, setRowCount] = useState(0)
  const [saving, setSaving] = useState(false)

  function trackUpdate(row: EmployeeRow) {
    if (addedRows.current.has(row.__lfRowId)) {
      addedRows.current.set(row.__lfRowId, row)
    } else {
      updatedRows.current.set(row.__lfRowId, row)
    }
    setChangeCount(addedRows.current.size + updatedRows.current.size + deletedRows.current.size)
  }

  useEffect(() => {
    let initialized = false
    let readyTimer: number | undefined

    const announceReady = () => {
      if (window.parent !== window) {
        console.log("submitting postMessage")
        window.parent.postMessage({ type: 'employee-tabulator:ready' }, '*')
      } else {
       console.log("Running in a window") 
    }

    const handleMessage = (event: MessageEvent) => {
      const data = event.data
      if (
        data &&
        typeof data === 'object' &&
        'type' in data &&
        data.type !== 'employee-tabulator:init'
      ) {
        return
      }

      let incomingColumns: unknown[] | undefined
      let incomingRows: unknown[] | undefined

      if (Array.isArray(data) && data.length === 2) {
        ;[incomingColumns, incomingRows] = data
      } else if (data && typeof data === 'object') {
        const payload = data as { columns?: unknown; rows?: unknown; data?: unknown }
        incomingColumns = Array.isArray(payload.columns) ? payload.columns : undefined
        incomingRows = Array.isArray(payload.rows)
          ? payload.rows
          : Array.isArray(payload.data)
            ? payload.data
            : undefined
      }

      if (!incomingColumns || !incomingRows) return

      const normalizedColumns = normalizeColumns(incomingColumns)
      if (!normalizedColumns.length) {
        setMessage('The supplied column definition is empty or invalid')
        return
      }

      const normalizedRows = incomingRows.map((row, index) => ({
        ...(row && typeof row === 'object' ? row : {}),
        __lfRowId: `initial-${index}`,
        __lfLocked: true,
      })) as EmployeeRow[]

      initialized = true
      targetOrigin.current = event.origin === 'null' ? '*' : event.origin
      if (readyTimer !== undefined) window.clearInterval(readyTimer)
      addedRows.current.clear()
      updatedRows.current.clear()
      deletedRows.current.clear()
      setChangeCount(0)
      setColumns(normalizedColumns)
      setRows(normalizedRows)
      setRowCount(normalizedRows.length)
      setReady(true)
      setMessage('')
    }

    window.addEventListener('message', handleMessage)
    if (window.parent !== window) {
      announceReady()
      readyTimer = window.setInterval(() => {
        if (!initialized) announceReady()
      }, 1000)
    }
    return () => {
      window.removeEventListener('message', handleMessage)
      if (readyTimer !== undefined) window.clearInterval(readyTimer)
    }
  }, [])

  useEffect(() => {
    if (!ready || !tableElement.current) return

    const editableColumns = columns.map((column) => ({
      ...column,
      editor: column.editor ?? 'input',
      editable: (cell: { getRow: () => RowComponent }) =>
        column.editable !== false && !cell.getRow().getData().__lfLocked,
      headerFilter: column.headerFilter ?? 'input',
    }))

    const grid = new Tabulator(tableElement.current, {
      data: rows,
      index: '__lfRowId',
      columns: [
        ...editableColumns,
        {
          title: 'Row access',
          field: '__lfLocked',
          width: 132,
          minWidth: 132,
          hozAlign: 'center',
          headerSort: false,
          formatter: (cell) => {
            const locked = Boolean(cell.getValue())
            return `<span class="lock-state ${locked ? 'is-locked' : 'is-open'}"><span class="lock-dot"></span>${locked ? 'Locked' : 'Editable'}</span>`
          },
          cellClick: (_event, cell) => {
            const row = cell.getRow()
            row.update({ __lfLocked: !row.getData().__lfLocked })
            trackUpdate(row.getData() as EmployeeRow)
          },
        },
      ],
      layout: 'fitColumns',
      height: '100%',
      placeholder: 'No employee records',
      movableColumns: true,
      resizableColumnFit: true,
      selectableRows: 1,
      reactiveData: false,
      columnDefaults: { vertAlign: 'middle', tooltip: true },
    })

    grid.on('cellEdited', (cell: CellComponent) =>
      trackUpdate(cell.getRow().getData() as EmployeeRow),
    )
    grid.on('rowAdded', () => setRowCount(grid.getDataCount()))
    grid.on('rowDeleted', () => setRowCount(grid.getDataCount()))
    table.current = grid
    return () => {
      grid.destroy()
      table.current = null
    }
  }, [columns, ready, rows])

  function addRow() {
    const row: EmployeeRow = {
      ...Object.fromEntries(columns.map((column) => [column.field, ''])),
      __lfRowId: `added-${crypto.randomUUID()}`,
      __lfLocked: false,
    }
    addedRows.current.set(row.__lfRowId, row)
    table.current?.addRow(row, true)
    setChangeCount(addedRows.current.size + updatedRows.current.size + deletedRows.current.size)
  }

  function deleteSelectedRow() {
    const selected = table.current?.getSelectedRows()[0]
    if (!selected) return
    const row = selected.getData() as EmployeeRow
    if (addedRows.current.has(row.__lfRowId)) {
      addedRows.current.delete(row.__lfRowId)
    } else {
      deletedRows.current.set(row.__lfRowId, toPublicRow(row))
      updatedRows.current.delete(row.__lfRowId)
    }
    selected.delete()
    setChangeCount(addedRows.current.size + updatedRows.current.size + deletedRows.current.size)
  }

  function saveChanges() {
    const payload: ChangeSet = {
      type: 'employee-tabulator:save',
      added: [...addedRows.current.values()].map(toPublicRow),
      updated: [...updatedRows.current.values()].map(toPublicRow),
      deleted: [...deletedRows.current.values()],
    }
    window.parent.postMessage(payload, targetOrigin.current)
    addedRows.current.clear()
    updatedRows.current.clear()
    deletedRows.current.clear()
    setChangeCount(0)
    setSaving(true)
    window.setTimeout(() => setSaving(false), 1200)
  }

  function loadSample() {
    const sampleColumns = [
      { title: 'Employee ID', field: 'employeeId', width: 140 },
      { title: 'First name', field: 'firstName' },
      { title: 'Last name', field: 'lastName' },
      { title: 'Department', field: 'department' },
      { title: 'Work email', field: 'email' },
    ]
    const sampleRows = Array.from({ length: 3000 }, (_, index) => ({
      employeeId: `LF-${String(index + 1).padStart(4, '0')}`,
      firstName: ['Morgan', 'Avery', 'Jordan', 'Riley'][index % 4],
      lastName: ['Chen', 'Patel', 'Rivera', 'Wilson'][index % 4],
      department: ['People', 'Finance', 'Operations', 'Research'][index % 4],
      email: `employee${index + 1}@example.org`,
    }))
    setColumns(normalizeColumns(sampleColumns))
    targetOrigin.current = window.location.origin
    setRows(sampleRows.map((row, index) => ({
      ...row,
      __lfRowId: `sample-${index}`,
      __lfLocked: true,
    })))
    setRowCount(sampleRows.length)
    setReady(true)
    setMessage('')
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">LF</div>
        <div className="brand-copy"><span>PEOPLE OPERATIONS</span><strong>Employee register</strong></div>
        <div className="connection"><span className={ready ? 'connection-dot is-live' : 'connection-dot'} />{ready ? 'Form connected' : 'Awaiting form data'}</div>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">DIRECTORY <span>/</span> RECORDS</p>
          <h1>Employee records</h1>
          <p className="subheading">Review, update, and return changes to your form.</p>
        </div>
        <div className="record-total"><strong>{rowCount.toLocaleString()}</strong><span>records</span></div>
      </section>

      <section className="table-section" aria-label="Employee records">
        <div className="table-toolbar">
          <div className="table-title"><span className="section-index">01</span><h2>All employees</h2><span className="count-chip">{rowCount.toLocaleString()}</span></div>
          <div className="table-actions">
            <button className="button button-quiet" type="button" onClick={deleteSelectedRow} disabled={!ready}>Remove selected</button>
            <button className="button button-outline" type="button" onClick={addRow} disabled={!ready}><span aria-hidden="true">+</span> Add employee</button>
          </div>
        </div>
        {!ready ? (
          <div className="empty-state">
            <div className="empty-mark" aria-hidden="true">↘</div>
            <strong>{message}</strong>
            <span>Waiting for columns and employee rows.</span>
            <button className="sample-link" type="button" onClick={loadSample}>Preview with 3,000 sample records</button>
          </div>
        ) : (
          <div className="table-host"><div ref={tableElement} /></div>
        )}
        <footer className="table-footer">
          <span><span className="footer-dot" /> {ready ? 'Changes are held until saved' : 'No data loaded'}</span>
          <span>{changeCount ? `${changeCount} unsaved change${changeCount === 1 ? '' : 's'}` : 'No unsaved changes'}</span>
        </footer>
      </section>

      <div className="save-bar">
        <span>{changeCount ? `${changeCount} change${changeCount === 1 ? '' : 's'} ready to send` : 'No changes to send yet'}</span>
        <button className="button button-save" type="button" onClick={saveChanges} disabled={!ready || !changeCount || saving}>
          {saving ? 'Changes sent' : 'Save changes'} <span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className="page-foot"><span>LASERFICHE CLOUD FORM INTEGRATION</span><span>EMPLOYEE DATA</span></div>
    </main>
  )
}

export default App
