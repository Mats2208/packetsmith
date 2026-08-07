// El aviso de versión falla de dos maneras y las dos son silenciosas: no avisar
// cuando salió algo nuevo, o avisar para siempre porque `0.3.10` se leyó como
// más vieja que `0.3.9`. Ninguna de las dos se ve mirando la pantalla.
//
// La comparación se testea sola. Lo que toca la red se prueba contra un
// servidor de mentira levantado acá, nunca contra el registro real: un test que
// depende de npmjs.com falla los días que npm tiene un mal día.
import { expect, test, describe, afterEach, afterAll } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { comoActualizar, esMasNueva, ultimaPublicada, versionNueva } from "../src/version.ts"

describe("esMasNueva", () => {
  test("compara número por número, no como texto", () => {
    // El caso que rompe el `>` de cadenas: "0.3.10" < "0.3.9" alfabéticamente.
    expect(esMasNueva("0.3.10", "0.3.9")).toBe(true)
    expect(esMasNueva("0.3.9", "0.3.10")).toBe(false)
  })

  test("una versión igual no es novedad", () => {
    expect(esMasNueva("0.3.1", "0.3.1")).toBe(false)
  })

  test("sube por cualquiera de los tres números", () => {
    expect(esMasNueva("1.0.0", "0.9.9")).toBe(true)
    expect(esMasNueva("0.4.0", "0.3.9")).toBe(true)
    expect(esMasNueva("0.3.2", "0.3.1")).toBe(true)
    expect(esMasNueva("0.3.0", "0.3.1")).toBe(false)
  })

  test("la estable le gana a la prerelease del mismo número", () => {
    // Quien está probando una beta tiene que enterarse cuando sale la final.
    expect(esMasNueva("0.4.0", "0.4.0-beta.1")).toBe(true)
    expect(esMasNueva("0.4.0-beta.1", "0.4.0")).toBe(false)
  })

  test("tolera la `v` de adelante y los espacios", () => {
    expect(esMasNueva(" v0.4.0 ", "0.3.1")).toBe(true)
  })

  test("basura no dispara un aviso hacia arriba", () => {
    // Un registro que contesta cualquier cosa no puede mandar a nadie a
    // "actualizar" a una versión que no existe.
    expect(esMasNueva("no-soy-una-version", "0.3.1")).toBe(false)
  })
})

describe("comoActualizar", () => {
  test("npm cuando el binario vive en un node_modules", () => {
    expect(comoActualizar(join("C:", "nodejs", "node_modules", "packetsmith", "packetsmith.exe")))
      .toBe("npm i -g packetsmith@latest")
  })

  test("el instalador cuando el binario es el que dejó el instalador", () => {
    // Mandar a `npm i -g` a alguien que instaló con el script de curl es
    // mandarlo a un comando que capaz ni tiene.
    expect(comoActualizar(join(homedir(), ".packetsmith", "bin", "packetsmith")))
      .toContain("install.")
  })
})

describe("ultimaPublicada", () => {
  const tmp = mkdtempSync(join(tmpdir(), "ps-version-"))

  afterEach(() => {
    delete process.env.PACKETSMITH_REGISTRY_URL
    delete process.env.PACKETSMITH_VERSION_PATH
    delete process.env.PACKETSMITH_NO_UPDATE_CHECK
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  test("lee del registro y deja la respuesta en el disco", async () => {
    const cache = join(tmp, "nueva.json")
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ latest: "9.9.9" }) })
    process.env.PACKETSMITH_REGISTRY_URL = `http://localhost:${server.port}/dist-tags`
    process.env.PACKETSMITH_VERSION_PATH = cache
    try {
      expect(await ultimaPublicada()).toBe("9.9.9")
      expect(JSON.parse(await Bun.file(cache).text()).latest).toBe("9.9.9")
      expect(await versionNueva("0.3.1")).toBe("9.9.9")
    } finally {
      server.stop(true)
    }
  })

  test("sin red contesta con lo que haya guardado", async () => {
    const cache = join(tmp, "sin-red.json")
    writeFileSync(cache, JSON.stringify({ latest: "1.2.3", checkedAt: 0 }))
    // Un puerto donde no hay nadie: es el caso "el registro no contesta", que
    // no puede costarle el arranque a nadie ni borrar lo que ya se sabía.
    process.env.PACKETSMITH_REGISTRY_URL = "http://127.0.0.1:1/dist-tags"
    process.env.PACKETSMITH_VERSION_PATH = cache
    expect(await ultimaPublicada()).toBe("1.2.3")
  })

  test("una respuesta rota no rompe nada ni borra la caché", async () => {
    const cache = join(tmp, "rota.json")
    writeFileSync(cache, JSON.stringify({ latest: "1.2.3", checkedAt: 0 }))
    const server = Bun.serve({ port: 0, fetch: () => new Response("no soy json") })
    process.env.PACKETSMITH_REGISTRY_URL = `http://localhost:${server.port}/dist-tags`
    process.env.PACKETSMITH_VERSION_PATH = cache
    try {
      expect(await ultimaPublicada()).toBe("1.2.3")
    } finally {
      server.stop(true)
    }
  })

  test("una caché fresca no vuelve a preguntar", async () => {
    const cache = join(tmp, "fresca.json")
    writeFileSync(cache, JSON.stringify({ latest: "5.0.0", checkedAt: Date.now() }))
    let pedidos = 0
    const server = Bun.serve({
      port: 0,
      fetch: () => { pedidos++; return Response.json({ latest: "9.9.9" }) },
    })
    process.env.PACKETSMITH_REGISTRY_URL = `http://localhost:${server.port}/dist-tags`
    process.env.PACKETSMITH_VERSION_PATH = cache
    try {
      expect(await ultimaPublicada()).toBe("5.0.0")
      expect(pedidos).toBe(0)
    } finally {
      server.stop(true)
    }
  })

  test("PACKETSMITH_NO_UPDATE_CHECK no toca la red", async () => {
    let pedidos = 0
    const server = Bun.serve({
      port: 0,
      fetch: () => { pedidos++; return Response.json({ latest: "9.9.9" }) },
    })
    process.env.PACKETSMITH_REGISTRY_URL = `http://localhost:${server.port}/dist-tags`
    process.env.PACKETSMITH_VERSION_PATH = join(tmp, "apagado.json")
    process.env.PACKETSMITH_NO_UPDATE_CHECK = "1"
    try {
      expect(await versionNueva("0.0.1")).toBeUndefined()
      expect(pedidos).toBe(0)
    } finally {
      server.stop(true)
    }
  })
})
