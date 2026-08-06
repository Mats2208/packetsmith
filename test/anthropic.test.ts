// La traducción al protocolo de Anthropic Messages.
//
// Se testea `traducir()` y no el turno entero porque ahí viven las dos trampas
// del protocolo, y las dos tienen la misma forma desagradable: la PRIMERA vuelta
// del bucle sale perfecta y el 400 llega recién en la segunda, cuando ya se
// ejecutaron tools contra Packet Tracer. Un test que arma a mano el historial de
// la segunda vuelta las agarra sin red y sin gastar un token.
import { expect, test, describe } from "bun:test"
import { traducir } from "../src/engine/providers/anthropic-messages.ts"
import type { Mensaje } from "../src/engine/providers/openai-compat.ts"

const call = (id: string, name: string, args = "{}") => ({
  id, type: "function" as const, function: { name, arguments: args },
})

describe("traducir", () => {
  test("el system sale de los mensajes y se va a su propio campo", () => {
    // En este protocolo `system` NO es un mensaje: mandarlo como uno da 400.
    const { system, messages } = traducir([
      { role: "system", content: "sos un ingeniero de redes" },
      { role: "user", content: "hola" },
    ])
    expect(system).toBe("sos un ingeniero de redes")
    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual({ role: "user", content: "hola" })
  })

  test("varios system se juntan en uno", () => {
    const { system } = traducir([
      { role: "system", content: "uno" },
      { role: "system", content: "dos" },
    ])
    expect(system).toBe("uno\n\ndos")
  })

  test("las tool_calls del asistente pasan a bloques tool_use", () => {
    const { messages } = traducir([
      { role: "user", content: "listá los equipos" },
      {
        role: "assistant",
        content: "voy a mirar",
        tool_calls: [call("t1", "pt_list_devices", '{"filtro":"router"}')],
      },
    ])
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "voy a mirar" },
        { type: "tool_use", id: "t1", name: "pt_list_devices", input: { filtro: "router" } },
      ],
    })
  })

  test("un asistente sin nada no deja un mensaje vacío", () => {
    // Un mensaje con `content: []` es un 400 por sí solo.
    const { messages } = traducir([
      { role: "user", content: "hola" },
      { role: "assistant", content: "" },
    ])
    expect(messages).toHaveLength(1)
  })

  // TRAMPA 1. Es la que rompe recién en la segunda vuelta.
  test("los resultados de VARIAS tools van todos en UN solo mensaje", () => {
    const historial: Mensaje[] = [
      { role: "user", content: "armá la red" },
      {
        role: "assistant",
        content: "",
        tool_calls: [call("t1", "pt_add_device"), call("t2", "pt_add_link")],
      },
      { role: "tool", tool_call_id: "t1", content: "ok R1" },
      { role: "tool", tool_call_id: "t2", content: "ok enlace" },
    ]
    const { messages } = traducir(historial)

    // user, assistant, y UN solo user con los dos resultados adentro.
    expect(messages).toHaveLength(3)
    const ultimo = messages[2] as { role: string; content: unknown[] }
    expect(ultimo.role).toBe("user")
    expect(ultimo.content).toEqual([
      { type: "tool_result", tool_use_id: "t1", content: "ok R1" },
      { type: "tool_result", tool_use_id: "t2", content: "ok enlace" },
    ])
  })

  test("dos rondas de tools NO se juntan entre sí", () => {
    // Acumular sin mirar dejaría los resultados de la segunda ronda pegados a
    // los de la primera, antes del turno del asistente que los pidió.
    const { messages } = traducir([
      { role: "user", content: "armá la red" },
      { role: "assistant", content: "", tool_calls: [call("t1", "a")] },
      { role: "tool", tool_call_id: "t1", content: "ok" },
      { role: "assistant", content: "", tool_calls: [call("t2", "b")] },
      { role: "tool", tool_call_id: "t2", content: "ok" },
    ])
    expect(messages.map((m: any) => m.role)).toEqual([
      "user", "assistant", "user", "assistant", "user",
    ])
    expect((messages[2] as any).content).toHaveLength(1)
    expect((messages[4] as any).content).toHaveLength(1)
  })

  test("un mensaje del usuario después de tools abre uno nuevo", () => {
    const { messages } = traducir([
      { role: "assistant", content: "", tool_calls: [call("t1", "a")] },
      { role: "tool", tool_call_id: "t1", content: "ok" },
      { role: "user", content: "gracias" },
    ])
    expect(messages).toHaveLength(3)
    expect(messages[2]).toEqual({ role: "user", content: "gracias" })
  })

  // TRAMPA 2. Kimi K3 piensa por defecto, así que esto pasa SIEMPRE con él.
  test("los bloques crudos se devuelven intactos, con su firma", () => {
    const bloques = [
      { type: "thinking", thinking: "el router va primero", signature: "TM+OcI4DAu4F" },
      { type: "text", text: "listo" },
      { type: "tool_use", id: "t1", name: "pt_add_device", input: { modelo: "2911" } },
    ]
    const { messages } = traducir([
      { role: "user", content: "armá la red" },
      { role: "assistant", content: "listo", tool_calls: [call("t1", "pt_add_device")], bloques },
    ])
    // Tal cual vinieron. Reconstruirlos con el texto y las tools perdería la
    // firma del razonamiento, y sin firma la API contesta 400.
    expect((messages[1] as any).content).toBe(bloques)
    expect((messages[1] as any).content[0].signature).toBe("TM+OcI4DAu4F")
  })

  test("sin bloques crudos se reconstruye, que es lo correcto para un modelo que no piensa", () => {
    const { messages } = traducir([
      { role: "assistant", content: "hola", bloques: [] },
    ])
    expect((messages[0] as any).content).toEqual([{ type: "text", text: "hola" }])
  })

  test("argumentos ilegibles no revientan la traducción entera", () => {
    // El stream ya valida el JSON al cerrar el bloque; si igual llega algo roto,
    // que se caiga acá con el nombre de la tool y no con un `SyntaxError` pelado.
    expect(() => traducir([
      { role: "assistant", content: "", tool_calls: [call("t1", "pt_add_device", "{roto")] },
    ])).toThrow()
  })
})
