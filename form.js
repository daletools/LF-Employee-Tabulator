function debounce(func, delay = 500) {
  let timeoutId;

  return function (...args) {
    // 1. Clear any existing timer to reset the delay window
    clearTimeout(timeoutId);

    // 2. Set a new timer to execute the function after the delay
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

function toTabulatorData(input) {
  const records = Array.isArray(input) ? input : [input];

  const componentsByRow = records.map((record) =>
    Object.values(record ?? {}).filter(
      (item) =>
        item &&
        typeof item === "object" &&
        item.settings?.label &&
        Object.hasOwn(item, "data"),
    ),
  );

  const columnMap = new Map();

  for (const components of componentsByRow) {
    for (const component of components) {
      const { label, attributeName } = component.settings;
      const field = attributeName || label;

      if (!columnMap.has(field)) {
        columnMap.set(field, { title: label, field });
      }
    }
  }

  const columns = [...columnMap.values()];
  const rows = componentsByRow.map((components) => {
    const row = Object.fromEntries(columns.map(({ field }) => [field, ""]));

    for (const component of components) {
      const field =
        component.settings.attributeName || component.settings.label;
      row[field] = component.data ?? "";
    }

    return row;
  });

  return { columns, rows };
}

const TABULATOR_ORIGIN = "https://daletools.github.io";
let tabulatorWindow = null;
let requestTabulatorWindow = null;
let helloTimer = null;
let employeeTableReady = false;
let flightLookupReady = false;
let farmTableReady = false;
let initialDataSent = false;
let requestDataSent = false;
let helloScanLogged = false;
const connectedViews = new Set();
let allConnectionsLogged = false;

console.info("[LF bridge] script started", {
  origin: window.location.origin,
  parentFrameCount: window.parent.frames.length,
});

function readTableColumn(fieldId) {
  const value = LFForm.getFieldValues({ fieldId });
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function readFlightRows() {
  const fields = {
    Employee_Number: readTableColumn(51),
    Flight_Number: readTableColumn(52),
    Flight_Carrier: readTableColumn(53),
    Flight_Origin: readTableColumn(54),
    Flight_Destination: readTableColumn(55),
    Flight_Date: readTableColumn(56),
    Flight_Type: readTableColumn(57),
    Request_Status: readTableColumn(80),
    Farm: readTableColumn(82),
    Requested_Arrival: readTableColumn(83),
  };
  const rowCount = Math.max(
    0,
    ...Object.values(fields).map((values) => values.length),
  );

  return Array.from({ length: rowCount }, (_, index) =>
    Object.fromEntries(
      Object.entries(fields).map(([field, values]) => [
        field,
        values[index] ?? "",
      ]),
    ),
  );
}

function readEmployeeRows() {
  const employeeTable = LFForm.getFieldValues({ fieldId: 44 });
  return toTabulatorData(employeeTable).rows.map((row) => ({
    Employee_Number: row.Employee_Number ?? row.EmployeeNumber ?? "",
    FullName: row.FullName ?? "",
    Status: row.Status ?? "",
  }));
}

function buildTabulatorPayload() {
  const employeeRows = readEmployeeRows();

  return {
    type: "employee-tabulator:init",
    view: "flights",
    data: {
      employees: employeeRows,
      flights: readFlightRows(),
    },
  };
}

function sendTableToTabulator() {
  if (
    !tabulatorWindow ||
    !employeeTableReady ||
    !flightLookupReady ||
    initialDataSent
  ) {
    return;
  }

  const payload = buildTabulatorPayload();
  tabulatorWindow.postMessage(payload, TABULATOR_ORIGIN);
  initialDataSent = true;
  console.info("[LF bridge] flight init sent", {
    employees: payload.data.employees.length,
    flights: payload.data.flights.length,
  });
}

function buildEmployeeRequestPayload() {
  const farmValues = LFForm.getFieldValues({ fieldId: 70 });
  const farms = [
    ...new Set(
      (Array.isArray(farmValues) ? farmValues : [farmValues])
        .map((farm) => {
          if (typeof farm === "string") return farm.trim();
          if (!farm || typeof farm !== "object") return "";
          return String(
            farm.Farm ??
              farm.Farm_Name ??
              farm.Name ??
              farm.data ??
              farm.value ??
              "",
          ).trim();
        })
        .filter(Boolean),
    ),
  ];

  const employees = readEmployeeRows();
  const requestByEmployee = new Map();
  const arrivalFound = new Set();

  for (const flight of readFlightRows()) {
    const employeeNumber = String(flight.Employee_Number ?? "");
    if (!employeeNumber) continue;

    const request = requestByEmployee.get(employeeNumber) ?? {
      Employee_Number: employeeNumber,
      Request_Status: "",
      Farm: "",
      Preferred_Arrival_By: "",
      Flight_Number: "",
      Flight_Arrival: "",
      Departure_Airport: "",
      Arrival_Airport: "",
    };

    request.Request_Status ||= flight.Request_Status ?? "";
    request.Farm ||= flight.Farm ?? "";
    request.Preferred_Arrival_By ||= flight.Requested_Arrival ?? "";

    if (
      !arrivalFound.has(employeeNumber) &&
      String(flight.Flight_Type ?? "").toLowerCase() === "arrival"
    ) {
      request.Flight_Number = flight.Flight_Number ?? "";
      request.Flight_Arrival = flight.Flight_Date ?? "";
      request.Departure_Airport = flight.Flight_Origin ?? "";
      request.Arrival_Airport = flight.Flight_Destination ?? "";
      arrivalFound.add(employeeNumber);
    }

    requestByEmployee.set(employeeNumber, request);
  }

  return {
    type: "employee-tabulator:init",
    view: "employee-request",
    data: {
      employees,
      farms,
      requests: employees.map(
        (employee) =>
          requestByEmployee.get(String(employee.Employee_Number ?? "")) ?? {
            Employee_Number: String(employee.Employee_Number ?? ""),
          },
      ),
    },
  };
}

function sendEmployeeRequestsToTabulator() {
  if (
    !requestTabulatorWindow ||
    !employeeTableReady ||
    !flightLookupReady ||
    !farmTableReady ||
    requestDataSent
  ) {
    return;
  }

  const payload = buildEmployeeRequestPayload();
  requestTabulatorWindow.postMessage(payload, TABULATOR_ORIGIN);
  requestDataSent = true;
  console.info("[LF bridge] employee-request init sent", {
    employees: payload.data.employees.length,
    farms: payload.data.farms.length,
  });
}

async function appendFlightsToOutputTable(flights) {
  const validFlights = flights.filter((flight) => {
    const rawDate = flight.Flight_Date;
    const dateIsBlank =
      !rawDate ||
      (typeof rawDate === "object" && !rawDate.dateStr && !rawDate.timeStr);
    const deletionMarker =
      [
        flight.Flight_Number,
        flight.Flight_Carrier,
        flight.Flight_Origin,
        flight.Flight_Destination,
        flight.Flight_Type,
      ].every((value) => value == null || value === "") && dateIsBlank;

    return (
      flight.Employee_Number &&
      (deletionMarker || ["Arrival", "Departure"].includes(flight.Flight_Type))
    );
  });
  if (validFlights.length === 0) return 0;

  const existingEmployeeNumbers = LFForm.getFieldValues({ fieldId: 60 });
  const firstIndex = Array.isArray(existingEmployeeNumbers)
    ? existingEmployeeNumbers.length
    : existingEmployeeNumbers == null || existingEmployeeNumbers === ""
      ? 0
      : 1;

  await LFForm.addRow({ fieldId: 59 }, validFlights.length);

  for (let offset = 0; offset < validFlights.length; offset++) {
    const flight = validFlights[offset];
    const index = firstIndex + offset;
    const rawDate = flight.Flight_Date;
    const dateValue =
      rawDate && typeof rawDate === "object"
        ? {
            dateStr: rawDate.dateStr ?? "",
            ...(rawDate.timeStr ? { timeStr: rawDate.timeStr } : {}),
          }
        : { dateStr: String(rawDate ?? "") };

    await LFForm.setFieldValues(
      { fieldId: 60, index },
      String(flight.Employee_Number),
    );
    await LFForm.setFieldValues(
      { fieldId: 61, index },
      String(flight.Flight_Number ?? ""),
    );
    await LFForm.setFieldValues(
      { fieldId: 62, index },
      String(flight.Flight_Carrier ?? ""),
    );
    await LFForm.setFieldValues(
      { fieldId: 63, index },
      String(flight.Flight_Origin ?? ""),
    );
    await LFForm.setFieldValues(
      { fieldId: 64, index },
      String(flight.Flight_Destination ?? ""),
    );
    await LFForm.setFieldValues({ fieldId: 65, index }, dateValue);
    await LFForm.setFieldValues(
      { fieldId: 66, index },
      String(flight.Flight_Type),
    );
  }

  return validFlights.length;
}

function requestTextOrDefault(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function requestDateTime(value) {
  const source = value && typeof value === "object" ? value : null;
  const rawDate = source ? source.dateStr : value;
  const dateStr = String(rawDate ?? "")
    .split("T")[0]
    .trim();
  return {
    dateStr: dateStr || "1900-01-01",
    ...(dateStr && source?.timeStr ? { timeStr: String(source.timeStr) } : {}),
  };
}

async function appendEmployeeRequestsToOutputTable(requests) {
  if (requests.length === 0) return 0;

  const existingEmployeeNumbers = LFForm.getFieldValues({ fieldId: 72 });
  const firstIndex = Array.isArray(existingEmployeeNumbers)
    ? existingEmployeeNumbers.length
    : existingEmployeeNumbers == null || existingEmployeeNumbers === ""
      ? 0
      : 1;

  await LFForm.addRow({ fieldId: 71 }, requests.length);

  for (let offset = 0; offset < requests.length; offset++) {
    const request = requests[offset] ?? {};
    const index = firstIndex + offset;
    await LFForm.setFieldValues(
      { fieldId: 72, index },
      String(request.Employee_Number ?? ""),
    );
    await LFForm.setFieldValues(
      { fieldId: 73, index },
      String(request.FullName ?? ""),
    );
    await LFForm.setFieldValues(
      { fieldId: 74, index },
      requestTextOrDefault(request.Request_Status, "Cancel"),
    );
    await LFForm.setFieldValues(
      { fieldId: 75, index },
      requestTextOrDefault(request.Farm, "TBD"),
    );
    await LFForm.setFieldValues(
      { fieldId: 76, index },
      requestDateTime(request.Preferred_Arrival_By),
    );
    await LFForm.setFieldValues(
      { fieldId: 77, index },
      requestTextOrDefault(request.Flight_Number, "TBD"),
    );
    await LFForm.setFieldValues(
      { fieldId: 78, index },
      requestDateTime(request.Flight_Arrival),
    );
  }

  return requests.length;
}

window.addEventListener("message", (event) => {
  if (event.data?.type !== "employee-tabulator:ready") return;

  if (event.origin !== TABULATOR_ORIGIN || !event.source) {
    console.warn("[LF bridge] ignored ready message", {
      origin: event.origin,
      expectedOrigin: TABULATOR_ORIGIN,
      hasSource: Boolean(event.source),
      view: event.data?.view,
    });
    return;
  }

  const view =
    event.data.view === "employee-request" ? "employee-request" : "flights";
  if (!connectedViews.has(view)) {
    connectedViews.add(view);
    console.info("[LF bridge] connected", { view });
  }

  if (view === "employee-request") {
    requestTabulatorWindow = event.source;
    sendEmployeeRequestsToTabulator();
  } else {
    tabulatorWindow = event.source;
    sendTableToTabulator();
  }

  if (tabulatorWindow && requestTabulatorWindow && helloTimer !== null) {
    clearInterval(helloTimer);
    helloTimer = null;
    if (!allConnectionsLogged) {
      allConnectionsLogged = true;
      console.info("[LF bridge] all hosted views connected");
    }
  }
});

window.addEventListener("message", async (event) => {
  if (
    event.origin !== TABULATOR_ORIGIN ||
    event.source !== tabulatorWindow ||
    event.data?.type !== "employee-tabulator:save" ||
    !Array.isArray(event.data.flights)
  ) {
    return;
  }

  try {
    const rowsSaved = await appendFlightsToOutputTable(event.data.flights);
    event.source.postMessage(
      { type: "employee-tabulator:saved", rowsSaved },
      TABULATOR_ORIGIN,
    );
  } catch (error) {
    console.error("Could not append flights to output table", error);
    event.source.postMessage(
      {
        type: "employee-tabulator:save-error",
        message: error instanceof Error ? error.message : String(error),
      },
      TABULATOR_ORIGIN,
    );
  }
});

window.addEventListener("message", async (event) => {
  if (
    event.origin !== TABULATOR_ORIGIN ||
    event.source !== requestTabulatorWindow ||
    event.data?.type !== "employee-request:save" ||
    !Array.isArray(event.data.requests)
  ) {
    return;
  }

  try {
    const rowsSaved = await appendEmployeeRequestsToOutputTable(
      event.data.requests,
    );
    console.info("[LF bridge] employee requests saved", { rowsSaved });
    event.source.postMessage(
      { type: "employee-request:saved", rowsSaved },
      TABULATOR_ORIGIN,
    );
  } catch (error) {
    console.error("[LF bridge] could not save employee requests", error);
    event.source.postMessage(
      {
        type: "employee-request:save-error",
        message: error instanceof Error ? error.message : String(error),
      },
      TABULATOR_ORIGIN,
    );
  }
});

function sendHelloToTabulatorFrames() {
  if (!helloScanLogged) {
    helloScanLogged = true;
    console.info("[LF bridge] sending hello to child frames", {
      frameCount: window.parent.frames.length,
    });
    if (window.parent.frames.length === 0) {
      console.warn("[LF bridge] no child frames found for handshake");
    }
  }

  for (let index = 0; index < window.parent.frames.length; index++) {
    try {
      window.parent.frames[index].postMessage(
        { type: "employee-tabulator:hello" },
        "*",
      );
    } catch (error) {
      console.debug("Could not send tabulator hello to frame", index, error);
    }
  }
}

sendHelloToTabulatorFrames();
helloTimer = setInterval(sendHelloToTabulatorFrames, 250);

LFForm.onFieldChange(
  () => {
    if (!employeeTableReady) {
      console.info("[LF bridge] employee table ready");
    }
    employeeTableReady = true;
    sendTableToTabulator();
    sendEmployeeRequestsToTabulator();
  },
  { fieldId: 47 },
);

LFForm.onFieldChange(
  () => {
    if (!flightLookupReady) {
      console.info("[LF bridge] flight lookup ready");
    }
    flightLookupReady = true;
    sendTableToTabulator();
    sendEmployeeRequestsToTabulator();
  },
  { fieldId: 57 },
);

LFForm.onFieldChange(
  () => {
    if (!farmTableReady) {
      console.info("[LF bridge] farm table ready");
    }
    farmTableReady = true;
    sendEmployeeRequestsToTabulator();
  },
  { fieldId: 70 },
);
