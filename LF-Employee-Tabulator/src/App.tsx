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
  flights: Record<string, unknown>[]
}

const GRID_COLUMNS: ColumnDefinition[] = [
  { title: 'Employee number', field: 'Employee_Number', width: 145, editable: false },
  { title: 'Full name', field: 'FullName', width: 190, editable: false },
  { title: 'Status', field: 'Status', width: 125, editable: false },
  { title: 'Flight number', field: 'Flight_Number', width: 155 },
  { title: 'Carrier', field: 'Flight_Carrier', width: 145 },
  { title: 'Origin', field: 'Flight_Origin', width: 130 },
  { title: 'Destination', field: 'Flight_Destination', width: 145 },
  { title: 'Flight date', field: 'Flight_Date', width: 150, editor: 'date' },
  {
    title: 'Flight type',
    field: 'Flight_Type',
    width: 135,
    editor: 'list',
    editorParams: { values: ['Arrival', 'Departure'] },
  },
]

function columnsForFlights(flights: Record<string, unknown>[]): ColumnDefinition[] {
  const flightOptions: Record<string, string> = { '': '(Clear flight assignment)' }
  for (const flight of flights) {
    const flightNumber = String(flight.Flight_Number ?? '')
    if (flightNumber) flightOptions[flightNumber] = flightNumber
  }

  return GRID_COLUMNS.map((column) =>
    column.field === 'Flight_Number'
      ? {
          ...column,
          editor: 'list',
          editorParams: {
            values: flightOptions,
            autocomplete: true,
            listOnEmpty: true,
            allowEmpty: true,
            emptyValue: '',
            clearable: true,
            freetext: false,
          },
        }
      : column,
  )
}

function dateForGrid(value: unknown): string {
  if (value && typeof value === 'object' && 'dateStr' in value) {
    return String(value.dateStr ?? '')
  }
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

function buildGridRows(employees: Record<string, unknown>[], flights: Record<string, unknown>[]): EmployeeRow[] {
  const flightsByEmployee = new Map<string, Record<string, unknown>[]>()
  for (const flight of flights) {
    const employeeNumber = String(flight.Employee_Number ?? '')
    if (!employeeNumber) continue
    const matches = flightsByEmployee.get(employeeNumber) ?? []
    matches.push(flight)
    flightsByEmployee.set(employeeNumber, matches)
  }

  const rows: EmployeeRow[] = []
  for (const employee of employees) {
    const employeeNumber = String(
      employee.Employee_Number ?? employee.EmployeeNumber ?? employee.employeeNumber ?? '',
    )
    const employeeFlights = flightsByEmployee.get(employeeNumber) ?? [{}]
    for (const flight of employeeFlights) {
      const flightDate = flight.Flight_Date
      const dateTime = flightDate && typeof flightDate === 'object'
        ? flightDate as { dateStr?: string; timeStr?: string }
        : undefined
      rows.push({
        Employee_Number: employeeNumber,
        FullName: employee.FullName ?? employee.fullName ?? '',
        Status: employee.Status ?? employee.status ?? '',
        Flight_Number: flight.Flight_Number ?? '',
        Flight_Carrier: flight.Flight_Carrier ?? '',
        Flight_Origin: flight.Flight_Origin ?? '',
        Flight_Destination: flight.Flight_Destination ?? '',
        Flight_Date: dateForGrid(flightDate),
        Flight_Type: flight.Flight_Type ?? '',
        __lfFlightTime: dateTime?.timeStr ?? '',
        __lfRowId: `flight-${rows.length}`,
        __lfLocked: true,
        __lfNew: false,
      })
    }
  }
  return rows
}

function toFlightPayload(row: EmployeeRow): Record<string, unknown> {
  const dateStr = String(row.Flight_Date ?? '')
  const flightDate = dateStr
    ? {
        dateStr,
        ...(row.__lfFlightTime ? { timeStr: row.__lfFlightTime } : {}),
      }
    : ''

  return {
    Employee_Number: row.Employee_Number,
    Flight_Number: row.Flight_Number,
    Flight_Carrier: row.Flight_Carrier,
    Flight_Origin: row.Flight_Origin,
    Flight_Destination: row.Flight_Destination,
    Flight_Date: flightDate,
    Flight_Type: row.Flight_Type,
  }
}

function App() {
  const tableElement = useRef<HTMLDivElement>(null)
  const table = useRef<Tabulator | null>(null)
  const formWindow = useRef<Window | null>(null)
  const targetOrigin = useRef('*')
  const flightDefinitions = useRef(new Map<string, Record<string, unknown>>())
  const updatedRows = useRef(new Map<string, EmployeeRow>())
  const [columns, setColumns] = useState<ColumnDefinition[]>([])
  const [rows, setRows] = useState<EmployeeRow[]>([])
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('Waiting for employee data from Laserfiche')
  const [changeCount, setChangeCount] = useState(0)
  const [rowCount, setRowCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')

  function trackUpdate(row: EmployeeRow) {
    updatedRows.current.set(row.__lfRowId, row)
    setSaveNotice('')
    setChangeCount(updatedRows.current.size)
  }

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data

      if (data?.type === 'employee-tabulator:saved') {
        setSaving(false)
        setSaveNotice(`${Number(data.rowsSaved) || 0} flight row(s) added to the form.`)
        return
      }

      if (data?.type === 'employee-tabulator:save-error') {
        setSaving(false)
        setSaveNotice(`The form could not save flight rows: ${String(data.message ?? 'Unknown error')}`)
        return
      }

      if (data?.type === 'employee-tabulator:hello') {
        if (event.source && event.origin !== 'null') {
          formWindow.current = event.source as Window
          console.log('Replying ready to hello sender', event.origin)
          ;(event.source as Window).postMessage(
            { type: 'employee-tabulator:ready' },
            event.origin,
          )
        }
        return
      }

      if (
        data &&
        typeof data === 'object' &&
        'type' in data &&
        data.type !== 'employee-tabulator:init'
      ) {
        return
      }

      const payload = data as {
        data?: { employees?: unknown; flights?: unknown }
      }
      const employeeRows = payload.data?.employees
      const flightRows = payload.data?.flights
      if (!Array.isArray(employeeRows) || !Array.isArray(flightRows)) return

      const normalizedRows = buildGridRows(employeeRows, flightRows)
      const definitions = new Map<string, Record<string, unknown>>()
      for (const flight of flightRows) {
        const flightNumber = String(flight.Flight_Number ?? '')
        if (flightNumber && !definitions.has(flightNumber)) {
          definitions.set(flightNumber, flight)
        }
      }
      flightDefinitions.current = definitions

      targetOrigin.current = event.origin === 'null' ? '*' : event.origin
      if (event.source) formWindow.current = event.source as Window
      setChangeCount(0)
      setColumns(columnsForFlights(flightRows))
      setRows(normalizedRows)
      setRowCount(normalizedRows.length)
      setReady(true)
      setMessage('')
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
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
          },
        },
      ],
      layout: 'fitColumns',
      height: '100%',
      placeholder: 'No employee records',
      movableColumns: true,
      resizableColumnFit: true,
      reactiveData: false,
      columnDefaults: { vertAlign: 'middle', tooltip: true },
    })

    grid.on('cellEdited', (cell: CellComponent) => {
      const row = cell.getRow()
      if (cell.getField() === 'Flight_Number') {
        const flightNumber = String(cell.getValue() ?? '')
        const definition = flightDefinitions.current.get(flightNumber)
        if (!flightNumber) {
          row.update({
            Flight_Carrier: '',
            Flight_Origin: '',
            Flight_Destination: '',
            Flight_Date: '',
            Flight_Type: '',
            __lfFlightTime: '',
          })
        } else if (definition) {
          const dateTime = definition.Flight_Date && typeof definition.Flight_Date === 'object'
            ? definition.Flight_Date as { dateStr?: string; timeStr?: string }
            : undefined
          row.update({
            Flight_Carrier: definition.Flight_Carrier ?? '',
            Flight_Origin: definition.Flight_Origin ?? '',
            Flight_Destination: definition.Flight_Destination ?? '',
            Flight_Date: dateForGrid(definition.Flight_Date),
            Flight_Type: definition.Flight_Type ?? '',
            __lfFlightTime: dateTime?.timeStr ?? '',
          })
        }
      }
      trackUpdate(row.getData() as EmployeeRow)
    })
    grid.on('rowAdded', () => setRowCount(grid.getDataCount()))
    grid.on('rowDeleted', () => setRowCount(grid.getDataCount()))
    table.current = grid
    return () => {
      grid.destroy()
      table.current = null
    }
  }, [columns, ready, rows])

  function saveChanges() {
    const changedRows = [...updatedRows.current.values()]
    const invalidRows = changedRows.filter((row) => {
      const deletionMarker = [
        row.Flight_Number,
        row.Flight_Carrier,
        row.Flight_Origin,
        row.Flight_Destination,
        row.Flight_Date,
        row.Flight_Type,
      ].every((value) => value == null || value === '')
      return !row.Employee_Number ||
        (!deletionMarker && !['Arrival', 'Departure'].includes(String(row.Flight_Type)))
    })
    if (invalidRows.length) {
      setSaveNotice('Choose an existing flight number or clear the flight assignment on every changed row.')
      return
    }

    const payload: ChangeSet = {
      type: 'employee-tabulator:save',
      flights: changedRows.map(toFlightPayload),
    }
    ;(formWindow.current ?? window.parent).postMessage(payload, targetOrigin.current)
    updatedRows.current.clear()
    setChangeCount(0)
    setSaveNotice('Flight rows sent to the form.')
    setSaving(true)
    window.setTimeout(() => setSaving(false), 1200)
  }

  function loadSample() {
    const employees = Array.from({ length: 3000 }, (_, index) => ({
      Employee_Number: `LF-${String(index + 1).padStart(4, '0')}`,
      FullName: ['Morgan Chen', 'Avery Patel', 'Jordan Rivera', 'Riley Wilson'][index % 4],
      Status: ['Active', 'Leave', 'Active', 'Terminated'][index % 4],
    }))
    const flights = employees.slice(0, 4).map((employee, index) => ({
      Employee_Number: employee.Employee_Number,
      Flight_Number: `LF${420 + index}`,
      Flight_Carrier: 'Northstar Air',
      Flight_Origin: 'YVR',
      Flight_Destination: 'YYZ',
      Flight_Date: { dateStr: '2026-10-01', timeStr: '08:30:00 AM' },
      Flight_Type: index % 2 === 0 ? 'Departure' : 'Arrival',
    }))
    flightDefinitions.current = new Map(flights.map((flight) => [String(flight.Flight_Number), flight]))
    setColumns(columnsForFlights(flights))
    targetOrigin.current = window.location.origin
    const sampleRows = buildGridRows(employees, flights)
    setRows(sampleRows)
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
        <span>{saveNotice || (changeCount ? `${changeCount} change${changeCount === 1 ? '' : 's'} ready to send` : 'No changes to send yet')}</span>
        <button className="button button-save" type="button" onClick={saveChanges} disabled={!ready || !changeCount || saving}>
          {saving ? 'Changes sent' : 'Save changes'} <span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className="page-foot"><span>LASERFICHE CLOUD FORM INTEGRATION</span><span>EMPLOYEE DATA</span></div>
    </main>
  )
}

export default App
