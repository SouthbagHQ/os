import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/iso.yml',import.meta.url),'utf8');
test('release is explicit, main-only and refuses diagnostic images',()=>{
 assert.match(workflow,/publish_release:[\s\S]*?default: false/);
 assert.match(workflow,/GITHUB_REPOSITORY.*SouthbagHQ\/os/);
 assert.match(workflow,/GITHUB_REF.*refs\/heads\/main/);
 assert.match(workflow,/DORMANT.*false/);
});
test('release waits for successful build and positive boot evidence',()=>{
 assert.match(workflow,/needs: build/);
 assert.match(workflow,/BOOT_READY: \$\{\{ needs.build.outputs.boot_ready \}\}/);
 assert.match(workflow,/BOOT_READY.*true/);
 assert.match(workflow,/ready=true.*GITHUB_OUTPUT/);
});
test('release checksums downloaded image and refuses existing tags',()=>{
 assert.match(workflow,/sha256sum --check SHA256SUMS/);
 assert.match(workflow,/git\/ref\/tags\/\$RELEASE_TAG/);
 assert.match(workflow,/gh release create.*southbag-os.iso SHA256SUMS/);
 assert.doesNotMatch(workflow,/--clobber|--force/);
});
test('write permission is confined to release job',()=>{
 const [build,release]=workflow.split('\n  release:\n');
 assert.doesNotMatch(build,/contents: write/);
 assert.match(release,/contents: write/);
 assert.match(release,/cancel-in-progress: false/);
});
