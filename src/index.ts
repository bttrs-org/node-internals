import path from 'node:path';
import fs from 'node:fs';
import { Configuration } from 'webpack';

function longestString(arr: string[]): string {
    return arr.reduce((prev, current) => (prev.length < current.length ? current : prev), '');
}

function getDependencyModules(): string[] {
    const modules = [];

    const lockFilePath = path.join(process.cwd(), 'package-lock.json');
    const lockFile = JSON.parse(fs.readFileSync(lockFilePath).toString());

    for (const pkg of Object.keys(lockFile.packages)) {
        if (
            pkg.startsWith('node_modules') &&
            !lockFile.packages[pkg].dev &&
            !lockFile.packages[pkg].devOptional &&
            modules.indexOf(pkg) === -1
        ) {
            modules.push(pkg);
        }
    }

    return modules;
}

export default function nodeInternals(): Configuration['externals'] {
    const moduleRegexp = new RegExp('(node_modules(?:[/\\\\][\\w\\-@.]+)+)', 'g');
    const bsRegexp = new RegExp('\\\\', 'g');
    // const availableModules = [...extraModules.map(e => `node_modules/${e}`), ...getDependencyModules()];
    const availableModules = [...getDependencyModules()];

    function getModuleName(context: string, request: string) {
        if (request.startsWith('.')) {
            const modulePath = context.match(moduleRegexp)?.[0]?.replace(bsRegexp, '/') ?? '';
            const moduleCandidates = availableModules.filter((m) => modulePath.startsWith(m));

            return longestString(moduleCandidates) || null;
        }
        // find best matching module for absolute import

        // find module candidates matching request. Could be nested in another module
        const requestParts = request.split('/');
        let moduleCandidates: string[] = [];
        while (!moduleCandidates.length && requestParts.length) {
            moduleCandidates = availableModules.filter((x) => x.endsWith(`node_modules/${requestParts.join('/')}`));
            requestParts.pop();
        }

        if (!moduleCandidates.length) {
            return null;
        }

        // find candidates that match context to find nested dependency
        const contextParts = context.match(moduleRegexp)?.[0]?.replace(bsRegexp, '/').split('/') ?? '';

        let bestCandidateContextMatchLength = 0;
        let bestCandidateContextMatch = '';
        for (const candidate of moduleCandidates) {
            const candidateParts = candidate.split('/');
            const maxIndex = Math.min(contextParts.length, candidateParts.length);

            let match = '';
            for (let i = 0; i < maxIndex; i++) {
                if (contextParts[i] === candidateParts[i]) {
                    match += '/' + contextParts[i];
                } else {
                    break;
                }
            }
            if (match !== '/node_modules' && match.length > bestCandidateContextMatchLength) {
                bestCandidateContextMatchLength = match.length;
                bestCandidateContextMatch = candidate;
            }
        }

        if (!bestCandidateContextMatch) {
            bestCandidateContextMatch = longestString(moduleCandidates);
        }

        return bestCandidateContextMatch || null;
    }

    return function ({ context, request }, callback) {
        if ((context ?? '').indexOf('node_modules') === -1) {
            callback();
            return;
        }

        const moduleName = getModuleName(context ?? '', request ?? '');

        if (!moduleName) {
            // Externalize to a commonjs module using the request path
            callback(undefined, 'commonjs ' + request);
            return;
        }

        // Continue without externalizing the import
        callback();
    };
}
