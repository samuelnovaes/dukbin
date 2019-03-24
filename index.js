const fs = require('fs-extra')
const path = require('path')
const cp = require('child_process')
const babel = require('@babel/core')
const env = require('@babel/preset-env')
const walk = require('walk')
const uglify = require('uglify-js')
const os = require('os')
const chalk = require('chalk')

const input = process.argv[2]
const output = process.argv[3]

if (!input) {
	console.error(chalk.redBright('Missing output file'))
	process.exit(1)
}
if (!output) {
	console.error(chalk.redBright('Missing output file'))
	process.exit(1)
}

const buildDir = path.join(os.tmpdir(), '__dukbin__')
const srcDir = path.join(__dirname, 'src')
const inputFile = path.resolve(process.cwd(), input)
const execFile = path.resolve(process.cwd(), output)
const cwd = path.dirname(inputFile)

function getModules() {
	return new Promise(async (resolve, reject) => {
		const modules = { paths: '', indexes: '', libs: [], funcs: [] }
		const walker = walk.walk(cwd)

		walker.on('file', async (root, stats, next) => {
			const modulePath = path.join(root, stats.name)
			const relativePath = path.relative(cwd, modulePath)
			if (path.extname(stats.name) == '.js' && modulePath != inputFile) {
				process.stdout.write(`Building ${chalk.bold(modulePath)} `)
				babel.transformFile(modulePath, { presets: [env], compact: true }, (err, result) => {
					if (err) {
						console.log()
						console.error(err.toString())
						process.exit(1)
					}

					modules.paths += `modules["${relativePath}"]=${JSON.stringify(uglify.minify(result.code, { mangle: { toplevel: true } }).code)};\n\t`
					modules.paths += `modules["${relativePath.replace(/\.js$/, '')}"]=modules["${relativePath}"];\n\t`
					console.log(chalk.greenBright('OK'))
					next()
				})
			}
			else if (path.extname(stats.name) == '.cpp') {
				if (/^duk_/.test(stats.name) || stats.name == 'duktape.cpp') {
					console.error(chalk.redBright(`Invalid C/C++ filename '${stats.name}'`))
					console.error(chalk.redBright(`The filename can not be 'duktape.c' or begin with the 'duk_' prefix`))
					process.exit(1)
				}

				await fs.copy(modulePath, path.join(buildDir, relativePath))
				await fs.copy(path.join(srcDir, 'duktape.h'), path.join(buildDir, `${path.dirname(relativePath)}/duktape.h`))
				await fs.copy(path.join(srcDir, 'duk_config.h'), path.join(buildDir, `${path.dirname(relativePath)}/duk_config.h`))
				modules.libs.push(relativePath)
				next()
			}
			else if (path.extname(stats.name) == '.h') {
				if (/^duk_/.test(stats.name) || stats.name == 'duktape.h') {
					console.error(chalk.redBright(`Invalid C/C++ header filename '${stats.name}'`))
					console.error(chalk.redBright(`The filename can not be 'duktape.h' or begin with the 'duk_' prefix`))
					process.exit(1)
				}

				await fs.copy(modulePath, path.join(buildDir, relativePath))
				next()
			}
			else if (stats.name == 'cfunctions') {
				const funcs = (await fs.readFile(modulePath, 'utf-8')).split('\n').map(func => func.trim())
				modules.funcs = modules.funcs.concat(funcs)
				next()
			}
			else next()
		})

		walker.on('directory', (root, stats, next) => {
			const modulePath = path.join(path.relative(cwd, root), stats.name)
			const fullPath = path.join(root, stats.name)
			try {
				modules.indexes += `indexes["${modulePath}"] = "${path.relative(cwd, require.resolve(fullPath))}";\n\t`
				next()
			}
			catch (err) {
				if (err.code == 'MODULE_NOT_FOUND') next()
				else reject(err)
			}
		})

		walker.on('end', () => {
			resolve(modules)
		})
	})
}

babel.transformFile(inputFile, { presets: [env] }, async (err, result) => {
	if (err) {
		console.error(err.toString())
		process.exit(0)
	}

	await fs.ensureDir(buildDir)
	const modules = await getModules()

	const code = (await fs.readFile(path.join(srcDir, 'duk_build.cpp'), 'utf-8'))
		.split('"__content__"').join(JSON.stringify(uglify.minify(result.code, { mangle: { toplevel: true } }).code))
		.split('/*__modules__*/').join(modules.paths)
		.split('/*__indexes__*/').join(modules.indexes)
		.split('/*__headers__*/').join(modules.funcs.map(func => `int ${func}(duk_context *ctx);`).join('\n'))
		.split('/*__functions__*/').join(modules.funcs.map(func => `duk_push_c_function(ctx, ${func}, DUK_VARARGS);\n\tduk_put_global_string(ctx, "${func}");`).join('\n\t'))

	const bindings = {
		targets: [
			{
				target_name: "build",
				type: "executable",
				sources: ["duk_build.cpp", "duktape.c", "duk_console.c", "duk_module_node.c", ...modules.libs]
			}
		]
	}

	await fs.writeFile(path.join(buildDir, 'duk_build.cpp'), code)
	await fs.writeFile(path.join(buildDir, 'binding.gyp'), JSON.stringify(bindings))
	for (const file of (await fs.readdir(srcDir))) {
		if (file != 'duk_build.cpp') await fs.copy(path.join(srcDir, file), path.join(buildDir, file))
	}

	process.stdout.write(`Building ${chalk.bold(inputFile)} `)
	cp.exec('npx node-gyp rebuild', { cwd: buildDir }, async (error, stdout, stderr) => {
		if (error) {
			console.log()
			console.error(chalk.redBright(error))
			await fs.remove(buildDir)
			process.exit(0)
		}
		else {
			console.log(chalk.greenBright('OK'))
			await fs.copy(path.join(buildDir, 'build', 'Release', 'build'), execFile)
			await fs.remove(buildDir)
		}
	})
})