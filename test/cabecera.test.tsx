// La cabecera y el medidor tienen que decir la verdad DEL MOTOR EN USO.
//
// Los tres bugs de acá se veían iguales entre sí —un dato viejo en pantalla— y
// ninguno lo agarraba `tsc`:
//
//   · el modelo se quedaba en `…` para siempre, porque `"…"` es una cadena no
//     vacía y ganaba el `||` contra el modelo que sí habías elegido;
//   · el esfuerzo no estaba en ningún lado, así que `xhigh` tardaba el triple
//     sin nada en pantalla que lo explicara;
//   · el medidor se montaba una sola vez, así que después de cambiar de motor
//     seguía mostrando el consumo del anterior — un número de otro plan
//     presentado como si fuera de este.
import { expect, test, describe, afterEach, beforeEach } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src/tui/app.tsx"
import { dialog } from "../src/tui/picker.tsx"
import type { AgentEvent, Engine } from "../src/engine/types.ts"
import type { Medida } from "../src/engine/providers/usage.ts"
import pkg from "../package.json" with { type: "json" }

afterEach(() => dialog.cerrarTodo())

// Estos tests necesitan el medidor ENCENDIDO, y `PACKETSMITH_NO_QUOTA` lo apaga.
//
// No alcanza con no ponerla: otros tres archivos de test la ponen a nivel de
// módulo, y Bun evalúa todos los módulos en el MISMO proceso antes de correr
// nada. Si alguno de ellos se evalúa primero, acá llega puesta.
//
// Eso hacía que estos tres pasaran en Windows y fallaran en Linux, porque el
// orden en que se recorren los archivos no es el mismo. Un test que depende del
// entorno que dejó otro archivo no está probando lo que dice probar.
let previo: string | undefined
beforeEach(() => {
  previo = process.env.PACKETSMITH_NO_QUOTA
  delete process.env.PACKETSMITH_NO_QUOTA
})
afterEach(() => {
  if (previo === undefined) delete process.env.PACKETSMITH_NO_QUOTA
  else process.env.PACKETSMITH_NO_QUOTA = previo
})

/** Un motor de mentira que informa lo que se le diga. */
function motorFalso(opts: {
  name: string
  modeloQueInforma?: string
  plan?: string
  uso?: Medida
}): Engine {
  return {
    name: opts.name,
    ...(opts.plan ? { planActual: () => opts.plan } : {}),
    models: () => [{ value: "uno" }, { value: "dos" }],
    ...(opts.uso ? { uso: async () => opts.uso } : {}),
    start: () => ({
      send: () => true,
      async *events(): AsyncIterable<AgentEvent> {
        if (opts.modeloQueInforma) {
          yield { type: "ready", sessionId: "s", model: opts.modeloQueInforma, tools: ["a", "b"] }
        }
        await new Promise(() => {})
      },
      close() {},
    }),
  }
}

async function montar(engine: Engine, props: Record<string, unknown> = {}) {
  const s = await testRender(
    () => App({ engine, columns: 100, ...props }),
    { width: 100, height: 24 },
  )
  await new Promise((r) => setTimeout(r, 80))
  return s
}
const cabecera = async (s: Awaited<ReturnType<typeof montar>>) => {
  await s.renderOnce()
  return (await s.captureCharFrame()).split("\n")[0]!
}
const barra = async (s: Awaited<ReturnType<typeof montar>>) => {
  await s.renderOnce()
  return (await s.captureCharFrame()).split("\n").find((l) => l.includes("READY")) ?? ""
}

describe("la cabecera", () => {
  test("dice proveedor, modelo y esfuerzo, cada uno etiquetado", async () => {
    const s = await montar(motorFalso({ name: "kimi", modeloQueInforma: "k3", plan: "coding" }), {
      effort: "high",
    })
    const h = await cabecera(s)
    expect(h).toContain("PROVIDER KIMI/CODING")
    expect(h).toContain("MODEL K3")
    expect(h).toContain("EFFORT HIGH")
  })

  test("la placa dice la versión EXACTA, no la familia", async () => {
    // Estaba cortada en `0.3`, así que 0.3.1, 0.3.2 y 0.3.3 se veían iguales —
    // y entre dos de esas hay un binario que se muere en cualquier carpeta con
    // un preload. Es el número que se pega en un reporte de bug: si la placa
    // vuelve a redondear, esto tiene que fallar.
    const s = await montar(motorFalso({ name: "kimi" }))
    const h = await cabecera(s)
    expect(h).toContain(`REV ${pkg.version}`)
    // El parche tiene que estar: `0.3` a secas no alcanza.
    expect(pkg.version.split(".")).toHaveLength(3)
  })

  test("el modelo PEDIDO se muestra aunque el motor no haya dicho el suyo", async () => {
    // Este es el bug: `…` no es un valor, es lo que se dibuja cuando no se
    // sabe. Guardado como estado ganaba el `||` y tapaba el modelo elegido.
    const s = await montar(motorFalso({ name: "claude" }), { model: "opus" })
    expect(await cabecera(s)).toContain("MODEL OPUS")
  })

  test("sin motor ni modelo se admite no saber, en vez de inventar", async () => {
    const s = await montar(motorFalso({ name: "claude" }))
    expect(await cabecera(s)).toContain("MODEL …")
  })

  test("el que informa el motor le gana al que pedimos", async () => {
    // Si pedimos uno que no tiene, queremos ver el que usó.
    const s = await montar(motorFalso({ name: "kimi", modeloQueInforma: "k3" }), { model: "sonnet" })
    const h = await cabecera(s)
    expect(h).toContain("MODEL K3")
    expect(h).not.toContain("SONNET")
  })

  test("un proveedor con una sola puerta no la nombra", async () => {
    const s = await montar(motorFalso({ name: "deepseek", modeloQueInforma: "x" }))
    expect(await cabecera(s)).toContain("PROVIDER DEEPSEEK")
  })
})

describe("el medidor", () => {
  test("muestra el consumo del motor con el que arrancó", async () => {
    const s = await montar(motorFalso({
      name: "kimi", modeloQueInforma: "k3",
      uso: { ventana: "5H", sesion: 42, semanal: 13 },
    }))
    await new Promise((r) => setTimeout(r, 80))
    const b = await barra(s)
    expect(b).toContain("5H")
    expect(b).toContain("42%")
    expect(b).toContain("13%")
  })

  test("la ventana la nombra el PROVEEDOR, no la asumimos", async () => {
    // Kimi informa 300 minutos; otro plan puede informar 24 horas. Escribir
    // `5H` para todos sería inventar un dato que el proveedor ya da.
    const s = await montar(motorFalso({
      name: "otro", modeloQueInforma: "x",
      uso: { ventana: "24H", sesion: 10 },
    }))
    await new Promise((r) => setTimeout(r, 80))
    expect(await barra(s)).toContain("24H")
  })

  test("un motor SIN medidor no dibuja un porcentaje inventado", async () => {
    // La otra mitad del bug de la captura: si el motor nuevo no publica
    // consumo, la barra tiene que quedar sin número. Cuando el medidor se
    // montaba una sola vez, ahí era donde sobrevivía el del motor anterior.
    const s = await montar(motorFalso({ name: "claude", modeloQueInforma: "opus" }))
    await new Promise((r) => setTimeout(r, 80))
    const b = await barra(s)
    expect(b).not.toMatch(/\d+%/)
  })

  test("el medidor se le pide al motor, no se calcula acá", async () => {
    // Si el número saliera de la app y no del proveedor, cambiar de motor no
    // podría cambiarlo. Que venga de `uso()` es lo que hace posible el arreglo.
    let pedido = false
    const s = await montar({
      ...motorFalso({ name: "kimi", modeloQueInforma: "k3" }),
      async uso() { pedido = true; return { ventana: "5H", sesion: 7 } },
    })
    await new Promise((r) => setTimeout(r, 80))
    expect(pedido).toBe(true)
    expect(await barra(s)).toContain("7%")
  })
})

// Lo que NO está cubierto acá, y a propósito: el cambio de motor EN VIVO.
// `App` copia `props.engine` a una señal propia al montarse —`cambiarMotor` es
// quien la mueve— así que desde afuera no hay forma de empujarlo sin pasar por
// el registro real de motores, y ahí `claude` levantaría un proceso de verdad.
// Lo que sí se prueba es su mitad comprobable: que el número venga del motor y
// que un motor sin medidor no deje ninguno.
