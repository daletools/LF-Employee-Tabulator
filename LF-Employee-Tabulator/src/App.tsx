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

type RequestChangeSet = {
  type: 'employee-request:save'
  requests: Record<string, unknown>[]
}

type ViewMode = 'flights' | 'employee-request'
type RequestRow = EmployeeRow & {
  Request_Status: string
  Farm: string
  Preferred_Arrival_By: string
  Flight_Number: string
  Flight_Arrival: string
  Arrival_Airport: string
}

const FLIGHT_FIELDS = [
  'Flight_Number',
  'Flight_Carrier',
  'Flight_Origin',
  'Flight_Destination',
  'Flight_Date',
  'Flight_Time',
  'Flight_Type',
] as const
const FLIGHT_DEFINITION_FIELDS = FLIGHT_FIELDS.filter((field) => field !== 'Flight_Number')

function flightSnapshot(row: EmployeeRow): string {
  return JSON.stringify(FLIGHT_FIELDS.map((field) => row[field] ?? ''))
}

const REQUEST_FIELDS = [
  'Employee_Number',
  'FullName',
  'Status',
  'Request_Status',
  'Farm',
  'Preferred_Arrival_By',
  'Flight_Number',
  'Flight_Arrival',
  'Arrival_Airport',
] as const

function requestSnapshot(row: EmployeeRow): string {
  return JSON.stringify(REQUEST_FIELDS.map((field) => row[field] ?? ''))
}

function buildRequestRows(
  employees: Record<string, unknown>[],
  requests: Record<string, unknown>[] = [],
): RequestRow[] {
  const requestByEmployee = new Map(
    requests.map((request) => [String(request.Employee_Number ?? ''), request]),
  )

  return employees.map((employee, index) => {
    const employeeNumber = String(
      employee.Employee_Number ?? employee.EmployeeNumber ?? employee.employeeNumber ?? '',
    )
    const request = requestByEmployee.get(employeeNumber) ?? {}
    return {
      Employee_Number: employeeNumber,
      FullName: String(employee.FullName ?? employee.fullName ?? ''),
      Status: String(employee.Status ?? employee.status ?? ''),
      Request_Status: String(request.Request_Status ?? ''),
      Farm: String(request.Farm ?? ''),
      Preferred_Arrival_By: dateForGrid(request.Preferred_Arrival_By),
      Flight_Number: String(request.Flight_Number ?? ''),
      Flight_Arrival: dateForGrid(request.Flight_Arrival),
      Arrival_Airport: String(request.Arrival_Airport ?? ''),
      __lfRowId: `request-${index}`,
      __lfLocked: true,
    }
  })
}

function toRequestPayload(row: RequestRow): Record<string, unknown> {
  return {
    Employee_Number: row.Employee_Number,
    FullName: row.FullName,
    Request_Status: row.Request_Status,
    Farm: row.Farm,
    Preferred_Arrival_By: dateTimeForLaser(row.Preferred_Arrival_By, ''),
    Flight_Number: row.Flight_Number,
    Flight_Arrival: dateTimeForLaser(row.Flight_Arrival, ''),
  }
}

function flightDefinition(row: EmployeeRow): Record<string, unknown> {
  return Object.fromEntries(
    FLIGHT_DEFINITION_FIELDS.map((field) => [field, row[field] ?? '']),
  )
}

function laserTimeToInput(value: string): string {
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i)
  if (!match) return value.slice(0, 5)
  let hours = Number(match[1]) % 12
  if (match[3].toUpperCase() === 'PM') hours += 12
  return `${String(hours).padStart(2, '0')}:${match[2]}`
}

function inputTimeToLaser(value: string): string {
  const [rawHours, minutes] = value.split(':')
  if (rawHours === undefined || minutes === undefined) return ''
  const hours = Number(rawHours)
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 || 12
  return `${String(displayHours).padStart(2, '0')}:${minutes}:00 ${suffix}`
}

function dateForGrid(value: unknown): string {
  if (value && typeof value === 'object' && 'dateStr' in value) {
    return String(value.dateStr ?? '')
  }
  return typeof value === 'string' ? value.split('T')[0] : ''
}

function timeForGrid(value: unknown): string {
  if (value && typeof value === 'object' && 'timeStr' in value) {
    return laserTimeToInput(String(value.timeStr ?? ''))
  }
  if (typeof value === 'string' && value.includes('T')) {
    return value.split('T')[1].slice(0, 5)
  }
  return ''
}

function dateTimeForLaser(date: unknown, time: unknown): Record<string, string> | '' {
  const dateStr = String(date ?? '')
  const timeValue = String(time ?? '')
  if (!dateStr) return ''
  return {
    dateStr,
    ...(timeValue ? { timeStr: inputTimeToLaser(timeValue) } : {}),
  }
}

function flightNumberEditor(
  cell: CellComponent,
  onRendered: (callback: () => void) => void,
  success: (value: unknown) => boolean,
  cancel: (value: unknown) => void,
  options: Record<string, string>,
): HTMLInputElement {
  const input = document.createElement('input')
  const datalist = document.createElement('datalist')
  const listId = `flight-options-${crypto.randomUUID()}`
  let completed = false

  datalist.id = listId
  for (const [value, label] of Object.entries(options)) {
    const option = document.createElement('option')
    option.value = value
    option.label = label
    datalist.append(option)
  }
  document.body.append(datalist)

  input.type = 'text'
  input.value = String(cell.getValue() ?? '')
  input.setAttribute('list', listId)
  input.style.width = '100%'
  input.style.height = '100%'
  input.style.boxSizing = 'border-box'

  const cleanup = () => datalist.remove()
  const commit = () => {
    if (completed) return
    success(input.value)
    completed = true
    cleanup()
  }
  const cancelEdit = () => {
    if (completed) return
    completed = true
    cleanup()
    cancel(undefined)
  }

  input.addEventListener('change', commit)
  input.addEventListener('blur', commit)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') cancelEdit()
  })
  onRendered(() => input.focus())
  return input
}

const REQUEST_STATUS_TRANSITIONS: Record<string, string[]> = {
  '': ['Requested'],
  Requested: [''],
  Arrived: ['Request Return'],
  'Request Return': ['Arrived'],
}
const LOCKED_REQUEST_STATUSES = new Set(['Flight Booked', 'Return Flight Booked'])

function requestStatusEditor(
  cell: CellComponent,
  onRendered: (callback: () => void) => void,
  success: (value: unknown) => boolean,
  cancel: (value: unknown) => void,
): HTMLSelectElement {
  const currentStatus = String(cell.getValue() ?? '')
  const select = document.createElement('select')
  const values = [currentStatus, ...(REQUEST_STATUS_TRANSITIONS[currentStatus] ?? [])]
  let completed = false

  for (const value of new Set(values)) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value || 'Blank'
    select.append(option)
  }

  select.value = currentStatus
  select.style.width = '100%'
  select.style.height = '100%'
  select.style.boxSizing = 'border-box'

  const commit = () => {
    if (completed) return
    success(select.value)
    completed = true
  }
  const cancelEdit = () => {
    if (completed) return
    completed = true
    cancel(undefined)
  }

  select.addEventListener('change', commit)
  select.addEventListener('blur', commit)
  select.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') cancelEdit()
  })
  onRendered(() => select.focus())
  return select
}

const GRID_COLUMNS: ColumnDefinition[] = [
  { title: 'Employee number', field: 'Employee_Number', minWidth: 112, widthGrow: 1.1, editable: false },
  { title: 'Full name', field: 'FullName', minWidth: 150, widthGrow: 1.6, editable: false },
  { title: 'Status', field: 'Status', minWidth: 90, widthGrow: 0.8, editable: false },
  { title: 'Flight number', field: 'Flight_Number', minWidth: 120, widthGrow: 1.1 },
  { title: 'Carrier', field: 'Flight_Carrier', minWidth: 120, widthGrow: 1.3 },
  { title: 'Origin', field: 'Flight_Origin', minWidth: 90, widthGrow: 0.8 },
  { title: 'Destination', field: 'Flight_Destination', minWidth: 110, widthGrow: 1.0 },
  { title: 'Flight date', field: 'Flight_Date', minWidth: 120, widthGrow: 1.0, editor: 'date' },
  { title: 'Flight time', field: 'Flight_Time', minWidth: 82, widthGrow: 0.8, editor: 'time' },
  {
    title: 'Flight type',
    field: 'Flight_Type',
    minWidth: 100,
    widthGrow: 0.9,
    editor: 'list',
    editorParams: { values: ['Arrival', 'Departure'] },
  },
]

function requestColumns(farms: string[]): ColumnDefinition[] {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const minDate = [
    tomorrow.getFullYear(),
    String(tomorrow.getMonth() + 1).padStart(2, '0'),
    String(tomorrow.getDate()).padStart(2, '0'),
  ].join('-')

  return [
    { title: 'Employee number', field: 'Employee_Number', minWidth: 112, widthGrow: 1.1, editable: false },
    { title: 'Full name', field: 'FullName', minWidth: 150, widthGrow: 1.5, editable: false },
    { title: 'Current status', field: 'Status', minWidth: 100, widthGrow: 0.9, editable: false },
    {
      title: 'Request status',
      field: 'Request_Status',
      minWidth: 135,
      widthGrow: 1.1,
      editor: requestStatusEditor,
    },
    {
      title: 'Farm',
      field: 'Farm',
      minWidth: 130,
      widthGrow: 1.1,
      editor: 'list',
      editorParams: { values: ['', ...farms] },
    },
    {
      title: 'Req. Arrival/Departure',
      field: 'Preferred_Arrival_By',
      minWidth: 155,
      widthGrow: 1.2,
      editor: 'date',
      editorParams: { min: minDate },
    },
    { title: 'Flight number', field: 'Flight_Number', minWidth: 120, widthGrow: 1.1 },
    { title: 'Flight arrival', field: 'Flight_Arrival', minWidth: 135, widthGrow: 1.1 },
    { title: 'Arrival airport', field: 'Arrival_Airport', minWidth: 130, widthGrow: 1.0 },
  ]
}

function columnsForFlights(
  flights: Record<string, unknown>[],
  flightOptions: Record<string, string>,
): ColumnDefinition[] {
  for (const key of Object.keys(flightOptions)) delete flightOptions[key]
  for (const flight of flights) {
    const flightNumber = String(flight.Flight_Number ?? '')
    if (flightNumber) flightOptions[flightNumber] = flightNumber
  }

  return GRID_COLUMNS.map((column) =>
    column.field === 'Flight_Number'
      ? {
          ...column,
          editor: (cell, onRendered, success, cancel) =>
            flightNumberEditor(cell, onRendered, success, cancel, flightOptions),
        }
      : column,
  )
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
      rows.push({
        Employee_Number: employeeNumber,
        FullName: employee.FullName ?? employee.fullName ?? '',
        Status: employee.Status ?? employee.status ?? '',
        Flight_Number: flight.Flight_Number ?? '',
        Flight_Carrier: flight.Flight_Carrier ?? '',
        Flight_Origin: flight.Flight_Origin ?? '',
        Flight_Destination: flight.Flight_Destination ?? '',
        Flight_Date: dateForGrid(flightDate),
        Flight_Time: timeForGrid(flightDate),
        Flight_Type: flight.Flight_Type ?? '',
        __lfRowId: `flight-${rows.length}`,
        __lfLocked: true,
        __lfNew: false,
      })
    }
  }
  return rows
}

function toFlightPayload(row: EmployeeRow): Record<string, unknown> {
  return {
    Employee_Number: row.Employee_Number,
    Flight_Number: row.Flight_Number,
    Flight_Carrier: row.Flight_Carrier,
    Flight_Origin: row.Flight_Origin,
    Flight_Destination: row.Flight_Destination,
    Flight_Date: dateTimeForLaser(row.Flight_Date, row.Flight_Time),
    Flight_Type: row.Flight_Type,
  }
}

function App() {
  const viewMode = useRef<ViewMode>(
    new URLSearchParams(window.location.search).get('view') === 'employee-request'
      ? 'employee-request'
      : 'flights',
  )
  const tableElement = useRef<HTMLDivElement>(null)
  const table = useRef<Tabulator | null>(null)
  const formWindow = useRef<Window | null>(null)
  const targetOrigin = useRef('*')
  const flightDefinitions = useRef(new Map<string, Record<string, unknown>>())
  const flightOptions = useRef<Record<string, string>>({})
  const originalRows = useRef(new Map<string, string>())
  const updatedRows = useRef(new Map<string, EmployeeRow>())
  const [columns, setColumns] = useState<ColumnDefinition[]>([])
  const [rows, setRows] = useState<EmployeeRow[]>([])
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState(
    viewMode.current === 'employee-request'
      ? 'Waiting for employee request data from Laserfiche'
      : 'Waiting for employee data from Laserfiche',
  )
  const [changeCount, setChangeCount] = useState(0)
  const [rowCount, setRowCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')

  function trackUpdate(row: EmployeeRow) {
    const original = originalRows.current.get(row.__lfRowId)
    const snapshot = viewMode.current === 'employee-request'
      ? requestSnapshot(row)
      : flightSnapshot(row)
    if (original !== undefined && original === snapshot) {
      updatedRows.current.delete(row.__lfRowId)
    } else {
      updatedRows.current.set(row.__lfRowId, row)
    }
    setSaveNotice('')
    setChangeCount(updatedRows.current.size)
  }

  function matchingFlightRows(flightNumber: string, exceptRowId?: string): RowComponent[] {
    const grid = table.current
    if (!grid || !flightNumber) return []

    return grid.getData()
      .filter((data) =>
        String(data.Flight_Number ?? '') === flightNumber && data.__lfRowId !== exceptRowId,
      )
      .map((data) => grid.getRow(data.__lfRowId))
      .filter((row): row is RowComponent => Boolean(row))
  }

  function updateFlightDefinition(flightNumber: string, row: EmployeeRow) {
    if (flightNumber) {
      flightDefinitions.current.set(flightNumber, {
        Flight_Number: flightNumber,
        ...flightDefinition(row),
      })
    }
  }

  function clearFlightDefinition(row: RowComponent) {
    row.update({
      Flight_Carrier: '',
      Flight_Origin: '',
      Flight_Destination: '',
      Flight_Date: '',
      Flight_Time: '',
      Flight_Type: '',
    })
  }

  function fillFlightDefinition(row: RowComponent, definition: Record<string, unknown>) {
    row.update({
      Flight_Carrier: definition.Flight_Carrier ?? '',
      Flight_Origin: definition.Flight_Origin ?? '',
      Flight_Destination: definition.Flight_Destination ?? '',
      Flight_Date: dateForGrid(definition.Flight_Date),
      Flight_Time: timeForGrid(definition.Flight_Date),
      Flight_Type: definition.Flight_Type ?? '',
    })
  }

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data

      if (data?.type === 'employee-tabulator:saved') {
        setSaving(false)
        setSaveNotice(`${Number(data.rowsSaved) || 0} flight row(s) added to the form.`)
        return
      }

      if (data?.type === 'employee-request:saved') {
        setSaving(false)
        setSaveNotice(`${Number(data.rowsSaved) || 0} employee request(s) saved to the form.`)
        return
      }

      if (data?.type === 'employee-tabulator:save-error') {
        setSaving(false)
        setSaveNotice(`The form could not save flight rows: ${String(data.message ?? 'Unknown error')}`)
        return
      }

      if (data?.type === 'employee-request:save-error') {
        setSaving(false)
        setSaveNotice(`The form could not save employee requests: ${String(data.message ?? 'Unknown error')}`)
        return
      }

      if (data?.type === 'employee-tabulator:hello') {
        if (event.source && event.origin !== 'null') {
          formWindow.current = event.source as Window
          console.log('Replying ready to hello sender', event.origin)
          ;(event.source as Window).postMessage(
            { type: 'employee-tabulator:ready', view: viewMode.current },
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
        view?: ViewMode
        data?: {
          employees?: unknown
          flights?: unknown
          farms?: unknown
          requests?: unknown
        }
      }
      if (payload.view && payload.view !== viewMode.current) return
      const employeeRows = payload.data?.employees
      if (!Array.isArray(employeeRows)) return

      if (viewMode.current === 'employee-request') {
        const farmValues = payload.data?.farms
        const requestValues = payload.data?.requests
        if (!Array.isArray(farmValues)) return
        const farms = [...new Set(farmValues.map((farm) => {
          if (typeof farm === 'string') return farm
          if (!farm || typeof farm !== 'object') return ''
          const entry = farm as Record<string, unknown>
          return String(entry.Farm ?? entry.Farm_Name ?? entry.Name ?? entry.data ?? '')
        }).filter(Boolean))]
        const requestRows = Array.isArray(requestValues) ? requestValues : []
        const normalizedRows = buildRequestRows(employeeRows, requestRows)

        targetOrigin.current = event.origin === 'null' ? '*' : event.origin
        if (event.source) formWindow.current = event.source as Window
        originalRows.current = new Map(
          normalizedRows.map((row) => [row.__lfRowId, requestSnapshot(row)]),
        )
        updatedRows.current.clear()
        setChangeCount(0)
        setColumns(requestColumns(farms))
        setRows(normalizedRows)
        setRowCount(normalizedRows.length)
        setReady(true)
        setMessage('')
        return
      }

      const flightRows = payload.data?.flights
      if (!Array.isArray(flightRows)) return

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
      originalRows.current = new Map(
        normalizedRows.map((row) => [row.__lfRowId, flightSnapshot(row)]),
      )
      updatedRows.current.clear()
      setChangeCount(0)
      setColumns(columnsForFlights(flightRows, flightOptions.current))
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
      editable: (cell: { getRow: () => RowComponent; getField: () => string }) => {
        const rowData = cell.getRow().getData()
        if (viewMode.current === 'employee-request') {
          const field = cell.getField()
          const requestStatus = String(rowData.Request_Status ?? '').trim()
          const isBooked = LOCKED_REQUEST_STATUSES.has(requestStatus)
          if (field === 'Request_Status') {
            return !isBooked && Object.hasOwn(REQUEST_STATUS_TRANSITIONS, requestStatus)
          }
          if (field === 'Farm') return Boolean(requestStatus)
          if (field === 'Preferred_Arrival_By') {
            return Boolean(requestStatus) && !isBooked
          }
          return false
        }
        return column.editable !== false && !rowData.__lfLocked
      },
      headerFilter: column.headerFilter ?? 'input',
    }))

    const tableColumns = viewMode.current === 'employee-request'
      ? editableColumns
      : [
          ...editableColumns,
          {
            title: 'Row access',
            field: '__lfLocked',
            minWidth: 104,
            widthGrow: 0.7,
            hozAlign: 'center' as const,
            headerSort: false,
            formatter: (cell: { getValue: () => unknown }) => {
              const locked = Boolean(cell.getValue())
              return `<span class="lock-state ${locked ? 'is-locked' : 'is-open'}"><span class="lock-dot"></span>${locked ? 'Locked' : 'Editable'}</span>`
            },
            cellClick: (_event: UIEvent, cell: CellComponent) => {
              const row = cell.getRow()
              row.update({ __lfLocked: !row.getData().__lfLocked })
            },
          },
        ]

    const grid = new Tabulator(tableElement.current, {
      data: rows,
      index: '__lfRowId',
      columns: tableColumns,
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
      const field = String(cell.getField())
      if (field === 'Flight_Number') {
        const oldFlightNumber = String(cell.getOldValue() ?? '')
        const flightNumber = String(cell.getValue() ?? '')
        const definition = flightDefinitions.current.get(flightNumber)
        const targets = oldFlightNumber && oldFlightNumber !== flightNumber
          ? matchingFlightRows(oldFlightNumber, row.getData().__lfRowId)
          : []
        const affectedRows = [row, ...targets]

        for (const target of targets) target.update({ Flight_Number: flightNumber })
        if (!flightNumber) {
          for (const target of affectedRows) clearFlightDefinition(target)
        } else if (definition) {
          for (const target of affectedRows) fillFlightDefinition(target, definition)
        } else {
          for (const target of affectedRows) clearFlightDefinition(target)
          updateFlightDefinition(flightNumber, row.getData() as EmployeeRow)
        }
        if (flightNumber) flightOptions.current[flightNumber] = flightNumber
        for (const target of affectedRows) trackUpdate(target.getData() as EmployeeRow)
        return
      }

      const rowData = row.getData() as EmployeeRow
      const flightNumber = String(rowData.Flight_Number ?? '')
      if (flightNumber && (FLIGHT_DEFINITION_FIELDS as readonly string[]).includes(field)) {
        const updates = { [field]: rowData[field] }
        for (const target of matchingFlightRows(flightNumber, rowData.__lfRowId)) {
          target.update(updates)
          trackUpdate(target.getData() as EmployeeRow)
        }
        updateFlightDefinition(flightNumber, rowData)
      }
      trackUpdate(rowData)
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
    const changedRows = [...updatedRows.current.values()].filter((row) => {
      const original = originalRows.current.get(row.__lfRowId)
      const current = viewMode.current === 'employee-request'
        ? requestSnapshot(row)
        : flightSnapshot(row)
      return original === undefined || original !== current
    })
    for (const rowId of updatedRows.current.keys()) {
      if (!changedRows.some((row) => row.__lfRowId === rowId)) {
        updatedRows.current.delete(rowId)
      }
    }
    setChangeCount(changedRows.length)

    if (viewMode.current === 'employee-request') {
      const payload: RequestChangeSet = {
        type: 'employee-request:save',
        requests: (changedRows as RequestRow[]).map(toRequestPayload),
      }
      ;(formWindow.current ?? window.parent).postMessage(payload, targetOrigin.current)
      updatedRows.current.clear()
      setChangeCount(0)
      setSaveNotice('Employee request updates sent to the form.')
      setSaving(true)
      return
    }

    const invalidRows = changedRows.filter((row) => {
      const deletionMarker = [
        row.Flight_Number,
        row.Flight_Carrier,
        row.Flight_Origin,
        row.Flight_Destination,
        row.Flight_Date,
        row.Flight_Time,
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
    setColumns(columnsForFlights(flights, flightOptions.current))
    targetOrigin.current = window.location.origin
    const sampleRows = buildGridRows(employees, flights)
    originalRows.current = new Map(
      sampleRows.map((row) => [row.__lfRowId, flightSnapshot(row)]),
    )
    updatedRows.current.clear()
    setRows(sampleRows)
    setRowCount(sampleRows.length)
    setReady(true)
    setMessage('')
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">LF</div>
        <div className="brand-copy"><span>PEOPLE OPERATIONS</span><strong>{viewMode.current === 'employee-request' ? 'Employee requests' : 'Employee register'}</strong></div>
        <div className="connection"><span className={ready ? 'connection-dot is-live' : 'connection-dot'} />{ready ? 'Form connected' : 'Awaiting form data'}</div>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">DIRECTORY <span>/</span> {viewMode.current === 'employee-request' ? 'REQUESTS' : 'RECORDS'}</p>
          <h1>{viewMode.current === 'employee-request' ? 'Employee requests' : 'Employee records'}</h1>
          <p className="subheading">{viewMode.current === 'employee-request' ? 'Manage employee hiring requests. This form allows read/write for Request Status, Farm, and Requested Arrival, but is read only for employee and flight data.' : 'Review, update, and return changes to your form.'}</p>
        </div>
        <div className="record-total"><strong>{rowCount.toLocaleString()}</strong><span>records</span></div>
      </section>

      <section className="table-section" aria-label="Employee records">
        <div className="table-toolbar">
          <div className="table-title"><span className="section-index">01</span><h2>{viewMode.current === 'employee-request' ? 'Employee requests' : 'All employees'}</h2><span className="count-chip">{rowCount.toLocaleString()}</span></div>
        </div>
        {!ready ? (
          <div className="empty-state">
            <div className="empty-mark" aria-hidden="true">↘</div>
            <strong>{message}</strong>
            <span>Waiting for columns and employee rows.</span>
            {viewMode.current === 'flights' && <button className="sample-link" type="button" onClick={loadSample}>Preview with 3,000 sample records</button>}
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
          {saving ? 'Changes sent' : viewMode.current === 'employee-request' ? 'Save requests' : 'Save changes'} <span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className="page-foot"><span>LASERFICHE CLOUD FORM INTEGRATION</span><span>EMPLOYEE DATA</span></div>
    </main>
  )
}

export default App
