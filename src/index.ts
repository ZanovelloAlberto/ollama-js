import * as utils from './utils.ts'
import { Ollama as OllamaBrowser } from './browser.ts'
import { crypto } from "https://deno.land/std@0.223.0/crypto/mod.ts";
import type { CreateRequest, ProgressResponse } from './interfaces.ts'
import * as path from "https://deno.land/std@0.223.0/path/mod.ts";  

export class Ollama extends OllamaBrowser {
  async encodeImage(image: Uint8Array | string): Promise<string> {
    if (typeof image !== 'string') {
      // image is Uint8Array or Buffer, convert it to base64
      const result = new TextDecoder().decode(image)
      return result
    }
    try {

      if (Deno.statSync(image).isFile) {
        // this is a filepath, read the file and convert it to base64
        const fileBuffer = await Deno.readFile(image)
        // Uint8Array convert it to base64
        return btoa(String.fromCharCode(...fileBuffer))
      }
    } catch {
      // continue
    }
    // the string may be base64 encoded
    return image
  }

  private async parseModelfile(
    modelfile: string,
    mfDir: string = Deno.cwd(),
  ): Promise<string> {
    const out: string[] = []
    const lines = modelfile.split('\n')
    for (const line of lines) {
      const [command, args] = line.split(' ', 2)
      if (['FROM', 'ADAPTER'].includes(command.toUpperCase())) {
        const path = this.resolvePath(args.trim(), mfDir)
        if (await this.fileExists(path)) {
          out.push(`${command} @${await this.createBlob(path)}`)
        } else {
          out.push(`${command} ${args}`)
        }
      } else {
        out.push(line)
      }
    }
    return out.join('\n')
  }

  private resolvePath(inputPath:string, mfDir: string) {
    if (inputPath.startsWith('~')) {
      return path.join (Deno.env.get("HOME") || "", inputPath.slice(1))
    }
    return path.resolve(mfDir, inputPath)
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      (await Deno.stat(path)).isFile
      return true
    } catch {
      return false
    }
  }

  private async createBlob(path: string): Promise<string> {
    if (typeof ReadableStream === 'undefined') {
      // Not all fetch implementations support streaming
      // TODO: support non-streaming uploads
      throw new Error('Streaming uploads are not supported in this environment.')
    }

    // Create a stream for reading the file
    const fileStream = await Deno.readFile(path)
    const sha256sum = crypto.subtle.digest('SHA3-256',fileStream )
    


    const digest = `sha256:${sha256sum}`

    try {
      await utils.head(this.fetch, `${this.config.host}/api/blobs/${digest}`)
    } catch (e) {
      if (e instanceof Error && e.message.includes('404')) {
        const readableStream = new ReadableStream({
          start(controller) {
            controller.enqueue(fileStream);
            controller.close();
            controller.error(new Error("error"));
          }
        })

        await utils.post(
          this.fetch,
          `${this.config.host}/api/blobs/${digest}`,
          readableStream,
        )
      } else {
        throw e
      }
    }

    return digest
  }

  create(
    request: CreateRequest & { stream: true },
  ): Promise<AsyncGenerator<ProgressResponse>>
  create(request: CreateRequest & { stream?: false }): Promise<ProgressResponse>

  async create(
    request: CreateRequest,
  ): Promise<ProgressResponse | AsyncGenerator<ProgressResponse>> {
    let modelfileContent = ''
    if (request.path) {
      let decoder = new TextDecoder("utf-8")
      modelfileContent = decoder.decode(await Deno.readFile(request.path))
      // modelfileContent = await promises.readFile(request.path, { encoding: 'utf8' })
      modelfileContent = await this.parseModelfile(
        modelfileContent,
        path.dirname(request.path),
      )
    } else if (request.modelfile) {
      modelfileContent = await this.parseModelfile(request.modelfile)
    } else {
      throw new Error('Must provide either path or modelfile to create a model')
    }
    request.modelfile = modelfileContent

    // check stream here so that typescript knows which overload to use
    if (request.stream) {
      return super.create(request as CreateRequest & { stream: true })
    } else {
      return super.create(request as CreateRequest & { stream: false })
    }
  }
}

export default new Ollama()


Deno.test("test", async () => {
  const ollama = new Ollama()
  let res = await ollama.generate({
    model: "gemma:2b",
    prompt: "cioa come stai?",
  })
  
  let cont = res.response
  console.log(cont)
  // assertEquals(result, "AQIDBAU=")
})

// export all types from the main entry point so that packages importing types dont need to specify paths
export * from './interfaces.ts'
