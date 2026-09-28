const formato = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function fechaHoraLima(d: Date): { fecha: string; hora: string } {
  const p = Object.fromEntries(formato.formatToParts(d).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}:${p.second}` };
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function rangoMes(fecha: string): { desde: string; hasta: string; mes: string } {
  const mes = fecha.slice(0, 7);
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}`, mes };
}

export function mesAnterior(mes: string, n = 1): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 - n, 1));
  return d.toISOString().slice(0, 7);
}
