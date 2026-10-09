import { createFileRegistry, fromBinary, fromJson, toBinary, toJson } from "@bufbuild/protobuf"
import {
  DescriptorProtoSchema,
  FieldDescriptorProtoSchema,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  ServiceDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ownerCommit = "981df60e74b65eccfc2d58044db9965928e4d37e"
const vendorRoot = `contract/vendor/kokoro-platform/${ownerCommit}`
const vendor = `contract/vendor/kokoro-platform/${ownerCommit}/proto`
const artifacts = {
  v5: `${vendorRoot}/execution-operations-v5`,
  v6: `${vendorRoot}/execution-operations-v6`,
  v7: `${vendorRoot}/execution-operations-v7`,
  v8: `${vendorRoot}/execution-operations-v8`,
  v9: `${vendorRoot}/execution-operations-v9`,
  v10: `${vendorRoot}/execution-operations-v10`,
}
const artifactAggregates = {
  v10: "277a2bf24b4fdc34196dac3c5fbba89ef88df75a3b96054af63547f9ae53ff0b",
  v9: "19c1466ab398c6dbb43130f3977fe776532e41e00e2487476d465f22fc936073",
  v8: "4a5ed2ca1a25673967ac2ee05a43c5f568bdd19c9ff768d8e606fdac94b9542f",
  v5: "3f97b3c98fd8e7ce46e4a8ea73237ddb85e764849d2b15dd28d0a3a58a69e42f",
  v6: "0d728881ba1046dc566131d63de71f6821ec636cf45837b5d937fee9872d5f91",
  v7: "3384a88f31be1fdd3e15bcbceb33e4fd7d62b04dfbfef65fcc35c24ce7afbb72",
}
const artifactProvenanceDigests = {
  v9: "cbfa5f46a495966722a5e2df50d17ce7d83c2f5c6a722bc13981ac4d5541ddef",
  v5: "787d8d1e7e4f734ea072c1e7516fd9cb36acb9eab0b87192c873ec0c10eabb43",
  v6: "3288cdad7e3a633c07873f255c52daa6bf6744831f81b3eeeb7340c12c75a312",
  v7: "cd8b08095c7410f7322bc51bd3ba68eeb084e1b0542ab35d8b26751694c65dec",
  v8: "a985f907fc9f2c5d8735c8918f1af6028efa9a3ed0f43b273612c592c2288444",
}
const descriptor = `${vendorRoot}/descriptor/platform-v1.binpb`
const descriptorDigest = "fc5d3893a05284a5f52d8de40b82f6e2bbd859608994d84dac20dff43a4a6fd2"
const parentDescriptor = `${vendorRoot}/descriptor/platform-v8-parent39.binpb`
const parentDigest = "0467c1c45e8ac27c79cb906e27bfdb679d88739e45bfa38128f0f629bec686d5"
const publicationAggregate = "64a22c1bd1d1deba9b10d1225c651f8b4a18e4217a6b309cdaff089e6dc6bd6e"
const publicationInputs = {
  "contract/descriptor/platform-installation-tags-parent-generated.binpb": {
    bytes: 35431,
    sha256: "9aa6cf2b817bf021f42e031b8eab2cd7d8cfb8701bb994aa3717b5ba815b8915",
  },
  "contract/descriptor/platform-installation-tags-parent.binpb": {
    bytes: 46951,
    sha256: "0e9d45786e09d528402e5971880bb73bf1a7aae474322eb960c6fc7acba4ec18",
  },
  "contract/descriptor/platform-package-read-parent-generated.binpb": {
    bytes: 35451,
    sha256: "c4caf5f9f4c92bacd38999af983af6828eaa2181d97307042897110c475cfdfd",
  },
  "contract/descriptor/platform-package-read-parent.binpb": {
    bytes: 46971,
    sha256: "37207ddd3513d0f0b1e3320401a54ab0848326692f9cc07571325bc325b4ddda",
  },
  "contract/descriptor/platform-skill-category-keys-http-3.5.0.json": {
    bytes: 35169,
    sha256: "370e3d7152796042f00095eda86eec4bc9883766c051f7f7dc864dce2b359b04",
  },
  "contract/descriptor/platform-skill-category-keys-parent-generated.binpb": {
    bytes: 37515,
    sha256: "7bfaf427b3d254dec151807d6bc32ab15947838437be75afe26c4e60a3f85dcd",
  },
  "contract/descriptor/platform-skill-category-keys-parent.binpb": {
    bytes: 49035,
    sha256: "d9b82ed81c643be7bab6cb19319fed86e566663a4cdae1c68afcc91386dab52b",
  },
  "contract/descriptor/platform-skill-example-prompts-http-3.4.0.json": {
    bytes: 33747,
    sha256: "ca90f41f124c53a690746434cb66ac774f4a134acf109decd44bb110fafa61d6",
  },
  "contract/descriptor/platform-skill-example-prompts-parent-generated.binpb": {
    bytes: 37302,
    sha256: "e416d960b344797b89418a2534f90c3b6923e9359ad48a6943a11005b9cd9567",
  },
  "contract/descriptor/platform-skill-example-prompts-parent.binpb": {
    bytes: 48822,
    sha256: "fcfab521242b07c17b08efad33463022625fd5163f1e62beb18ddd9589053808",
  },
  "contract/descriptor/platform-skill-github-asset-parent-generated.binpb": {
    bytes: 54454,
    sha256: "44d7a214e998a28fa6126d97e69458562225ccb45c338f80223126cf9e4becc9",
  },
  "contract/descriptor/platform-skill-github-asset-parent-http-5.0.0.json": {
    bytes: 49236,
    sha256: "67c4222266dfc888dc996f86782d4af5b27139d2e500268ab1b5b9f8af069111",
  },
  "contract/descriptor/platform-skill-github-asset-parent-profile-1.0.0.json": {
    bytes: 274219,
    sha256: "dce4ac2df444b3ec7795da77375d494f166611856cb424d614a901b7583907d9",
  },
  "contract/descriptor/platform-skill-github-asset-parent-vectors-1.0.0.json": {
    bytes: 734276,
    sha256: "9c11430dfd9c6610ebb4075803ad04b4ec5ad283fcd0d71e62ad66212afff201",
  },
  "contract/descriptor/platform-skill-github-asset-parent.binpb": {
    bytes: 67575,
    sha256: "f9bc56230b594ef168f77d0bca8b282795a00807464a788879d3a58e0ea9dda0",
  },
  "contract/descriptor/platform-skill-personal-query-parent-generated.binpb": {
    bytes: 54473,
    sha256: "033e577bc9d119089813ee4a4d14a2e8f4a6b3f5d712f7f7c38ac557833f3f5c",
  },
  "contract/descriptor/platform-skill-personal-query-parent-http-5.1.0.json": {
    bytes: 49213,
    sha256: "a8cef2bc45b2c0514f3d1abf06199087ad0efadf9db75224b17c69b1c50b12ce",
  },
  "contract/descriptor/platform-skill-personal-query-parent-profile-1.1.0.json": {
    bytes: 274465,
    sha256: "7a145160743773f5863cd68185a29aab25d29d09eb7f65094c8557dcaa2e5169",
  },
  "contract/descriptor/platform-skill-personal-query-parent-vectors-1.1.0.json": {
    bytes: 766009,
    sha256: "0932149e311a7496e9bed9565235d20b48f797b6e73c447a67fccc7cfd783ebc",
  },
  "contract/descriptor/platform-skill-personal-query-parent.binpb": {
    bytes: 67594,
    sha256: "4a8715b5057fbe3a9f443faee0315482de20593ce01430c7c357561a61576bfd",
  },
  "contract/descriptor/platform-skill-product-http-4.0.0.json": {
    bytes: 37781,
    sha256: "08c4ee5a66d9d44723a895f0d31094ae0b519500c9bed78cfec75ac1851cf238",
  },
  "contract/descriptor/platform-skill-product-parent-generated.binpb": {
    bytes: 37784,
    sha256: "eae7f129393e534842fe2f23909f40de83fe540c17a3b91837600d3ce1c2a045",
  },
  "contract/descriptor/platform-skill-product-parent.binpb": {
    bytes: 49304,
    sha256: "947abde6d3d083ceb14eb16e9bef023b25a183acb88e2f98ac44c372b16cfaa7",
  },
  "contract/descriptor/platform-skill-product-storage-v2.proto.snapshot": {
    bytes: 10666,
    sha256: "02266d53b8bfb7fdd6991b17d59ebb17399d4f189b6a3135fedcb69b6b364276",
  },
  "contract/descriptor/platform-skill-updated-at-http-3.3.0.json": {
    bytes: 33330,
    sha256: "b6e5d0e0118207ee37933e5c22e94c86d95d74307b22a44e26e8974fede82acf",
  },
  "contract/descriptor/platform-skill-updated-at-parent-generated.binpb": {
    bytes: 37232,
    sha256: "bf466c1288cb9bbd84e05a5122aa018b9a135377426099c3e158450a0f8f9b03",
  },
  "contract/descriptor/platform-skill-updated-at-parent.binpb": {
    bytes: 48752,
    sha256: "2e1a811bf347b5d9cd3577ac6c762ee9d31f40dea2ac326a06b83bc61de9a8d5",
  },
  "contract/descriptor/platform-v1.binpb": {
    bytes: 77018,
    sha256: "fc5d3893a05284a5f52d8de40b82f6e2bbd859608994d84dac20dff43a4a6fd2",
  },
  "contract/descriptor/platform-v8-parent39.binpb": {
    bytes: 43624,
    sha256: "0467c1c45e8ac27c79cb906e27bfdb679d88739e45bfa38128f0f629bec686d5",
  },
  "contract/descriptor/platform-v9-parent43-generated.binpb": {
    bytes: 35139,
    sha256: "25197edc2c40d19773147c6b433d1f56d180b8ecf9c758f404ac1bf3884eea40",
  },
  "contract/descriptor/platform-v9-parent43.binpb": {
    bytes: 46659,
    sha256: "5f0f00f605f6a445b4d80943459b69bf9f489fd7851cc80b6c2700f8f78a8d0e",
  },
  "contract/execution-operations/mcp-personal-product-request-vectors-v1.json": {
    bytes: 3453,
    sha256: "5fb9868da51570a1cbdba8b58c79bf6afe1db4963f698e0080e3df1ae3e8f0fe",
  },
  "contract/execution-operations/mcp-personal-product-v1.json": {
    bytes: 27458,
    sha256: "269dc9fddb5e02e931108b690aec67aaeab88ecebdfa4f37da90e63e8a272648",
  },
  "contract/execution-operations/skill-category-keys-v1.json": {
    bytes: 4651,
    sha256: "77893dbe7bbc40bd167ba130fc39431d347dee2fa9421b3aba2673819b604d7e",
  },
  "contract/execution-operations/skill-category-keys-v1.vectors.json": {
    bytes: 582408,
    sha256: "1ec6f1c5dce7f68fb01e6db16b7b72e053d46d10e717fc726503ff5504a1d60f",
  },
  "contract/execution-operations/skill-example-prompts-v1.json": {
    bytes: 3758,
    sha256: "8106cedbeed0ed2a1afb25983f6e8ebece3528b277f83bcdb5c227c655edd496",
  },
  "contract/execution-operations/skill-example-prompts-v1.vectors.json": {
    bytes: 574590,
    sha256: "fbded2af8f5b02df848ee6b326b018845e2cdbfefaa7d3ff5d6efc0b43c1a673",
  },
  "contract/execution-operations/skill-product-request-vectors-v1.json": {
    bytes: 766009,
    sha256: "794601f6632efb8cc72d2df1ddbc5af84c6803cbc951624aeada01f299a02036",
  },
  "contract/execution-operations/skill-product-v1.json": {
    bytes: 273395,
    sha256: "2629cd6838acac55215c2d4bea042d4d3a98e05ddcfe07cb3eb621b149bfb653",
  },
  "contract/execution-operations/skill-series-current-v1.json": {
    bytes: 526,
    sha256: "7ea63b4fcf3523dcc305207a7ac3956fd4c723f299f757bb566c6b5dab3b9227",
  },
  "contract/execution-operations/v10/local-skill-import-v1.json": {
    bytes: 2646,
    sha256: "d14f38288ba7708caa55b0a8dba99dce3d2dcb768526cee3ed263ac4642d2198",
  },
  "contract/execution-operations/v10/manifest.json": {
    bytes: 407,
    sha256: "dfdddd29763f43dc3dabea99c6d5b4ece457e4b5f39ff585f7c59667615300c3",
  },
  "contract/execution-operations/v10/provenance.json": {
    bytes: 506,
    sha256: "a565b343106284706d11f7cf8a18529df90bd2b9b6789f70ddaa9d017b7c3b21",
  },
  "contract/execution-operations/v5/command-identities.json": {
    bytes: 32532,
    sha256: "33d356f224de6c2c58bda6d414858013a295e442773887c7e196cdcd67f13b82",
  },
  "contract/execution-operations/v5/manifest.json": {
    bytes: 13371,
    sha256: "43768f526cf4465e1316a696484cb482da581fe7c00c29ca84de816cc956730c",
  },
  "contract/execution-operations/v5/operation-catalog.json": {
    bytes: 11230,
    sha256: "b39ff94ab27215dcd9122361ca7a9e000ddc7e723c0b598d16544d420774ddd9",
  },
  "contract/execution-operations/v5/product-installation-v1.json": {
    bytes: 10347,
    sha256: "699d2fd002581f9161c6ac737728a5480e68e121a4f46663b1395ea9e7a96fe0",
  },
  "contract/execution-operations/v5/provenance.json": {
    bytes: 1858,
    sha256: "787d8d1e7e4f734ea072c1e7516fd9cb36acb9eab0b87192c873ec0c10eabb43",
  },
  "contract/execution-operations/v5/schemas/command-identities.schema.json": {
    bytes: 37395,
    sha256: "4f9b9112afe2bd08f6189e1fc30050771b0a9eb508450a7e83080eba5a2df123",
  },
  "contract/execution-operations/v5/schemas/manifest.schema.json": {
    bytes: 17524,
    sha256: "39ee548bcfdd02745434e95420edca0699c1dbeb4f67d79e75aec2e5e812e8f4",
  },
  "contract/execution-operations/v5/schemas/operation-catalog.schema.json": {
    bytes: 12935,
    sha256: "bd9b987377cdd1cc9fc794f57c306d399bb28c0ffd0b7330122d888834958055",
  },
  "contract/execution-operations/v5/schemas/product-installation.schema.json": {
    bytes: 15222,
    sha256: "e1062ad73f2cf3ca1028e4ceff2c837d18dbd4885a3b6e8a08fa0639ebe97911",
  },
  "contract/execution-operations/v5/schemas/vector-inventory.schema.json": {
    bytes: 121741,
    sha256: "a70ef2767ed1cc90f6fb20cfa2fff5ef6bbf14ae00dac48235a8d06006be6f3e",
  },
  "contract/execution-operations/v5/vectors/product-installation.json": {
    bytes: 112930,
    sha256: "31efd14da208dffef6785b64cf42ed44c9875d40cf3013349fd6d1fd85cab62e",
  },
  "contract/execution-operations/v6/authorize-response-v1.json": {
    bytes: 1137,
    sha256: "b09776cceeda7d36ecc49e43b1ef4ccb9b426c9914825ec317805a5aa876174d",
  },
  "contract/execution-operations/v6/connection-projection-v1.json": {
    bytes: 1954,
    sha256: "3e29005afb0856936f6361f59ae197b76d59324d0a37c6c03f711756c891d29c",
  },
  "contract/execution-operations/v6/manifest.json": {
    bytes: 1181,
    sha256: "2f5adda27ca7de30771dfe2a0422797f3c8b8d3eeff7f2e870868b508792fa0a",
  },
  "contract/execution-operations/v6/provenance.json": {
    bytes: 1519,
    sha256: "3288cdad7e3a633c07873f255c52daa6bf6744831f81b3eeeb7340c12c75a312",
  },
  "contract/execution-operations/v6/schemas/authorize-response.schema.json": {
    bytes: 2293,
    sha256: "8cd877313c9e6ad60cae1f8c3d722cf3e3b47678bbbc60041a53c0df3f70a6db",
  },
  "contract/execution-operations/v6/schemas/connection-projection.schema.json": {
    bytes: 5637,
    sha256: "e33ef29a89c562ce74b3871522d004c5502709a70ad4afb1fe1647affa8418ce",
  },
  "contract/execution-operations/v6/schemas/manifest.schema.json": {
    bytes: 2275,
    sha256: "b6cecac8d80d78354b351cc5e4dde8f7dc9ef6bd89356e84aa8ed4fbb7d3c8e3",
  },
  "contract/execution-operations/v6/vectors/authorize-response.json": {
    bytes: 12300,
    sha256: "2bf8751822d4db00d053ceb41b60749ab452dd38db22b081a4e4e5e7b0ab147e",
  },
  "contract/execution-operations/v6/vectors/connection-projection.json": {
    bytes: 7474,
    sha256: "6c83cebd8006349d3e17c63d0e9f97209385f8b363822dc20869afbf39c8ae5a",
  },
  "contract/execution-operations/v7/manifest.json": {
    bytes: 391,
    sha256: "09ae832c861d0106986e15a0302574f33b4d9c89375f1284050d1d540b3f1b34",
  },
  "contract/execution-operations/v7/provenance.json": {
    bytes: 1135,
    sha256: "cd8b08095c7410f7322bc51bd3ba68eeb084e1b0542ab35d8b26751694c65dec",
  },
  "contract/execution-operations/v7/publish-v2.json": {
    bytes: 2472,
    sha256: "551b0f4ccec56b64644fcdce9eec0ff1c4020d0dc48eccdf02833cc74225de35",
  },
  "contract/execution-operations/v7/schemas/manifest.schema.json": {
    bytes: 1014,
    sha256: "c67b0173c36172d7f3870ac442567ac64c1b570535dda84b07bdbdcdc9583988",
  },
  "contract/execution-operations/v7/schemas/zip-profile-v2.schema.json": {
    bytes: 3090,
    sha256: "1204e84b628829e037a4e0f44f691d1eed07233c78bdf6b1a8ee5bbbc67613d1",
  },
  "contract/execution-operations/v7/vectors/zip-v2.json": {
    bytes: 4533,
    sha256: "66421e76274cca5b0d0ed3248d2c75151fea348341b250e523112ccfb151ad2c",
  },
  "contract/execution-operations/v7/zip-profile-v2.json": {
    bytes: 1630,
    sha256: "077b9a40d5525a77c7fe0814ed0afa4b48fc1c22dad72187c7aea10d9f6116a9",
  },
  "contract/execution-operations/v8/manifest.json": {
    bytes: 405,
    sha256: "cf9b40ebf83c6dd7ffc7f0b12f2de18c363b96866e7f330fe0eb4b2446f7966c",
  },
  "contract/execution-operations/v8/personal-mcp-read-v1.json": {
    bytes: 5493,
    sha256: "d45fd8f396cad4151d1f3de0feea74a3db5d796060025a206a1c6f16932cfa41",
  },
  "contract/execution-operations/v8/provenance.json": {
    bytes: 1007,
    sha256: "a985f907fc9f2c5d8735c8918f1af6028efa9a3ed0f43b273612c592c2288444",
  },
  "contract/execution-operations/v8/schemas/manifest.schema.json": {
    bytes: 1028,
    sha256: "de62c22fea26ac1859674b783d48abde78f39e5b5151c3f575f91fbf498fd460",
  },
  "contract/execution-operations/v8/schemas/personal-mcp-read.schema.json": {
    bytes: 6823,
    sha256: "4435f60a584fb3099267a326af98d16b532194f13e281d65cd274a73d9bd066e",
  },
  "contract/execution-operations/v8/vectors/personal-mcp-read.json": {
    bytes: 102719,
    sha256: "40555c30ccc84075163279d35dfc288cead6b728f8d98bf70f23628827d69cb8",
  },
  "contract/execution-operations/v9/global-mcp-registration-v1.json": {
    bytes: 2970,
    sha256: "7cfdb27781789887cf51f44d8fe44577950bbed6c05b2d99fd392c0c731e954e",
  },
  "contract/execution-operations/v9/manifest.json": {
    bytes: 411,
    sha256: "3b4caf81080ffc6e72c204ceb1bcf65e275f1ef47d1c0be4fe924e4983397fba",
  },
  "contract/execution-operations/v9/provenance.json": {
    bytes: 1024,
    sha256: "cbfa5f46a495966722a5e2df50d17ce7d83c2f5c6a722bc13981ac4d5541ddef",
  },
  "contract/execution-operations/v9/schemas/global-mcp-registration.schema.json": {
    bytes: 4287,
    sha256: "6276f648dd621f5d8ca3cf7d7f54889476ecf203dab970fe80b744193405853a",
  },
  "contract/execution-operations/v9/schemas/manifest.schema.json": {
    bytes: 1034,
    sha256: "0fc177c27c760ce9d574ccb623e00c2eebbeda35401a5b63cc7241a4fadf14cc",
  },
  "contract/execution-operations/v9/vectors/global-mcp-registration.json": {
    bytes: 47456,
    sha256: "7c256bbc3f9ed0cc93434595bd9caa7c2f0a00035837fadc2fc3dfa1110df9ed",
  },
  "contract/openapi/platform-http.openapi.json": {
    bytes: 52792,
    sha256: "c5f9a343170c87d59e0c40134c503cc6d40b59416216ac993a138cfbac3bb581",
  },
  "contract/proto/kokoro/common/v1/common.proto": {
    bytes: 2271,
    sha256: "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  },
  "contract/proto/kokoro/platform/v1/platform_runtime.proto": {
    bytes: 58465,
    sha256: "41fdcc2a782a779c38df861f99d89b1d20966486d29ed64647d1ecf149926bd6",
  },
  "contract/proto/kokoro/storage/v3/storage.proto": {
    bytes: 12626,
    sha256: "1021e603065978871c51519ddba5b23c9b97f16b781a08bd98e019b3342bf5f9",
  },
  "contract/provenance.json": {
    bytes: 1050,
    sha256: "6a28dcb90aaf2f402e1e0991996afa99887673291f40af0a854387372d3d2170",
  },
}

const output = path.join(root, "src/generated/platform-connect")
const manifestPath = path.join(root, "contract/dependencies/platform-connect.json")
const sourceDigests = {
  "kokoro/common/v1/common.proto": "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  "kokoro/platform/v1/platform_runtime.proto": "41fdcc2a782a779c38df861f99d89b1d20966486d29ed64647d1ecf149926bd6",
  "kokoro/storage/v3/storage.proto": "1021e603065978871c51519ddba5b23c9b97f16b781a08bd98e019b3342bf5f9",
}
const directories = ["kokoro", "kokoro/common", "kokoro/common/v1", "kokoro/platform", "kokoro/platform/v1", "kokoro/storage", "kokoro/storage/v3"]
const sourceDirectories = [...directories].sort()
const generationInputs = ["kokoro/common/v1/common.proto", "kokoro/platform/v1/platform_runtime.proto", "kokoro/storage/v3/storage.proto"]
const generatedFiles = ["kokoro/common/v1/common_pb.ts", "kokoro/platform/v1/platform_runtime_pb.ts", "kokoro/storage/v3/storage_pb.ts"]
const versions = {
  "@bufbuild/buf": "1.72.0",
  "@bufbuild/protoc-gen-es": "2.14.0",
  "@bufbuild/protobuf": "2.14.0",
  "@connectrpc/connect": "2.2.0",
  tsx: "4.23.12",
}
const configFiles = ["buf.platform.json", "buf.platform.gen.json"]

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

export function assertSourceDigests(sources) {
  assert.deepEqual(Object.keys(sources).sort(), Object.keys(sourceDigests).sort(), "Platform source allowlist drifted")
  for (const [file, digest] of Object.entries(sourceDigests)) assert.equal(sha256(sources[file]), digest, `Platform source digest drifted: ${file}`)
}

export function assertGeneratedTree(tree) {
  assert.deepEqual([...tree.files].sort(), generatedFiles, "Platform generated file allowlist drifted")
  assert.deepEqual([...tree.directories].sort(), directories, "Platform generated directory allowlist drifted")
}

export function assertVendorPins(entries) {
  assert.deepEqual(entries.map((entry) => entry.name).sort(), [ownerCommit], "Platform vendor commit allowlist drifted")
  assert.ok(entries[0]?.isDirectory(), "Platform vendor commit must be a real directory")
}

export function assertVendorLayout(entries) {
  const names = [
    "descriptor",
    "execution-operations",
    "execution-operations-v10",
    "execution-operations-v5",
    "execution-operations-v6",
    "execution-operations-v7",
    "execution-operations-v8",
    "execution-operations-v9",
    "openapi",
    "proto",
    "provenance.json",
  ]
  assert.deepEqual(entries.map((entry) => entry.name).sort(), names, "Platform vendor layout allowlist drifted")
  assert.ok(
    entries.every((entry) => (entry.name === "provenance.json" ? entry.isFile() : entry.isDirectory())),
    "Platform vendor inputs must be real directories/files",
  )
}

function vendorPath(ownerPath) {
  return ownerPath.replace(/^contract\//u, "").replace(/^execution-operations\/v(10|[5-9])\//u, "execution-operations-v$1/")
}

export function assertPublicationInputs(files) {
  assert.deepEqual(Object.keys(files).sort(), Object.keys(publicationInputs), "Platform complete publication allowlist drifted")
  const records = []
  for (const [file, expected] of Object.entries(publicationInputs)) {
    assert.equal(files[file].length, expected.bytes, `Platform publication byte length drifted: ${file}`)
    assert.equal(sha256(files[file]), expected.sha256, `Platform publication digest drifted: ${file}`)
    records.push(`${file}\0${expected.bytes}\0${expected.sha256}\n`)
  }
  assert.equal(sha256(Buffer.from(records.join(""))), publicationAggregate, "Platform complete publication aggregate drifted")
}

async function verifyPublicationInputs() {
  const actual = await tree(path.join(root, vendorRoot))
  const expectedFiles = Object.keys(publicationInputs).map(vendorPath).sort()
  const expectedDirectories = [
    ...new Set(
      expectedFiles.flatMap((file) => {
        const parts = file.split("/").slice(0, -1)
        return parts.map((_, index) => parts.slice(0, index + 1).join("/"))
      }),
    ),
  ].sort()
  assert.deepEqual(actual, { files: expectedFiles, directories: expectedDirectories }, "Platform complete publication filesystem drifted")
  assertPublicationInputs(
    Object.fromEntries(
      await Promise.all(Object.keys(publicationInputs).map(async (file) => [file, await readFile(path.join(root, vendorRoot, vendorPath(file)))])),
    ),
  )
}

async function tree(directory, prefix = "") {
  const result = { files: [], directories: [] }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      result.directories.push(relative)
      const child = await tree(path.join(directory, entry.name), relative)
      result.files.push(...child.files)
      result.directories.push(...child.directories)
    } else {
      assert.ok(entry.isFile(), `Platform artifact contains unsupported entry: ${relative}`)
      result.files.push(relative)
    }
  }
  return { files: result.files.sort(), directories: result.directories.sort() }
}

export function assertExecutionArtifact(provenance, files, expectedAggregate = artifactAggregates.v5) {
  assert.equal(provenance.aggregateSha256, expectedAggregate, "Platform artifact aggregate pin drifted")
  assert.deepEqual(Object.keys(files).sort(), provenance.files.map((entry) => entry.path).sort(), "Platform artifact file allowlist drifted")
  const records = []
  for (const entry of provenance.files) {
    const bytes = files[entry.path]
    assert.ok(bytes, `Platform artifact file missing: ${entry.path}`)
    assert.equal(bytes.length, entry.bytes, `Platform artifact byte length drifted: ${entry.path}`)
    assert.equal(sha256(bytes), entry.sha256, `Platform artifact digest drifted: ${entry.path}`)
    records.push(`${entry.path}\0${entry.bytes}\0${entry.sha256}\n`)
  }
  assert.equal(sha256(Buffer.from(records.join(""))), expectedAggregate, "Platform artifact aggregate drifted")
}

export async function verifyExecutionArtifactDirectory(directory, expectedAggregate = artifactAggregates.v5) {
  const provenanceBytes = await readFile(path.join(directory, "provenance.json"))
  const version = Object.keys(artifactAggregates).find((key) => artifactAggregates[key] === expectedAggregate)
  assert.ok(version, "Platform artifact aggregate not registered")
  assert.equal(sha256(provenanceBytes), artifactProvenanceDigests[version], "Platform provenance bytes drifted")
  const provenance = JSON.parse(provenanceBytes.toString("utf8"))
  const actual = await tree(directory)
  const expectedFiles = ["provenance.json", ...provenance.files.map((entry) => entry.path)].sort()
  const expectedDirectories = [
    ...new Set(
      provenance.files.flatMap((entry) => {
        const parts = entry.path.split("/").slice(0, -1)
        return parts.map((_, index) => parts.slice(0, index + 1).join("/"))
      }),
    ),
  ].sort()
  assert.deepEqual(actual.files, expectedFiles, "Platform artifact filesystem allowlist drifted")
  assert.deepEqual(actual.directories, expectedDirectories, "Platform artifact directory allowlist drifted")
  const files = Object.fromEntries(await Promise.all(provenance.files.map(async (entry) => [entry.path, await readFile(path.join(directory, entry.path))])))
  assertExecutionArtifact(provenance, files, expectedAggregate)
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))
  return { files, manifest }
}

export function assertProofChain(v5, v6, v7, v8) {
  assert.deepEqual(
    v8,
    {
      artifact: "platform-execution-operations",
      artifactVersion: "8.0.0",
      status: "inactive",
      routable: false,
      packageName: "kokoro.platform.v1",
      inherits: { version: "7.0.0", aggregateSha256: artifactAggregates.v7 },
      counts: { rpc: 43, command: 20, proof: 24 },
      profile: "personal-mcp-read-v1",
    },
    "Platform v8 proof drifted",
  )
  assert.deepEqual(
    {
      artifact: v5.artifact,
      artifactVersion: v5.artifactVersion,
      status: v5.status,
      routable: v5.routable,
    },
    {
      artifact: "platform-execution-operations",
      artifactVersion: "5.0.1",
      status: "inactive",
      routable: false,
    },
  )
  assert.equal(v5.inventories.operations, 39, "Platform operation inventory drifted")
  assert.equal(v5.inventories.readBindings, 1, "Platform Get read binding inventory drifted")
  assert.equal(v5.inventories.bindings, 24, "Platform request binding inventory drifted")
  assert.equal(v5.inventories.commandIdentities, 20, "Platform command identity inventory drifted")
  assert.equal(v5.inventories.productCommands, 3, "Platform product command inventory drifted")
  assert.equal(v5.inventories.safeFields, 9, "Platform safe projection inventory drifted")
  assert.equal(v5.baseArtifact.aggregateSha256, "902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79", "Platform v4 base artifact pin drifted")
  assert.deepEqual(
    {
      artifact: v6.artifact,
      artifactVersion: v6.artifactVersion,
      status: v6.status,
      routable: v6.routable,
      inherits: v6.inherits,
      counts: v6.counts,
    },
    {
      artifact: "platform-execution-operations",
      artifactVersion: "6.0.0",
      status: "inactive",
      routable: false,
      inherits: { version: "5.0.1", aggregateSha256: artifactAggregates.v5 },
      counts: { rpc: 39, command: 20, proof: 24 },
    },
    "Platform v6 proof drifted",
  )
  assert.deepEqual(
    v6.sourcePins,
    [
      { path: "contract/proto/kokoro/platform/v1/platform_runtime.proto", sha256: "2e1c0d19b986b43f05efd5ab8c2e9800d7b9f6785e93e25780006ae19007b502" },
      { path: "contract/descriptor/platform-v1.binpb", sha256: "ae2683134d6b780a003c9c485177fbab06632ecbfaeeb548f96fc440f2b2048c" },
      { path: "contract/provenance.json", sha256: "1f04cc50707d075893ff0e95e5c25f5a686d1206be26f67ce86ffe3f38bb696c" },
      { path: "src/generated/proto/kokoro/platform/v1/platform_runtime_pb.ts", sha256: "a8e5124e38f8bff1aa3838f9bec0e0e1f70f894b30161675b0f5f6b6308d1c7f" },
      { path: "contract/openapi/platform-http.openapi.json", sha256: "4b42dd161c972b3447cfea3a6f80a949bbdb573c46213dbf8ef4c3ecb58e72da" },
    ],
    "Platform v6 source pins drifted",
  )
  assert.deepEqual(
    {
      artifact: v7.artifact,
      artifactVersion: v7.artifactVersion,
      status: v7.status,
      routable: v7.routable,
      inherits: v7.inherits,
      counts: v7.counts,
      profile: v7.profile,
    },
    {
      artifact: "platform-execution-operations",
      artifactVersion: "7.0.0",
      status: "inactive",
      routable: false,
      inherits: { version: "6.0.0", aggregateSha256: artifactAggregates.v6 },
      counts: { rpc: 39, command: 20, proof: 24 },
      profile: "zip-v2",
    },
    "Platform v7 proof drifted",
  )
}

function assertV5Product(files) {
  const product = JSON.parse(files["product-installation-v1.json"].toString("utf8"))
  assert.equal(product.productVersion, "product-personal-installation/1.0.0")
  assert.equal(product.requests.length, 5)
  assert.equal(product.safeProjection.fields.length, 9)
}

// These are consumer assertions over the fixed publication, not runtime authorization.
const inspectionReads = [
  ["ProductSkillPackageInspectionService", "InspectPersonalSkillPackage", "skill_id", "SkillId"],
  ["ProductSkillInstallationPackageInspectionService", "InspectPersonalSkillInstallationPackage", "installation_id", "SkillInstallationId"],
]
const inspectionReserved = [
  "tenant_id",
  "actor_id",
  "subject_id",
  "owner_scope",
  "target_owner_scope",
  "product_context",
  "command",
  "execution_proof",
  "attestation",
]
function descriptorField(name, number, type, typeName, repeated = false, optional = false) {
  return {
    name,
    number,
    type,
    label: repeated ? 3 : 1,
    jsonName: name.replace(/_([a-z])/gu, (_, letter) => letter.toUpperCase()),
    ...(typeName === undefined ? {} : { typeName: `.kokoro.platform.v1.${typeName}` }),
    ...(optional ? { proto3Optional: true, oneofIndex: 0 } : {}),
  }
}
function platformFile(set) {
  const files = set.file.filter((file) => file.package === "kokoro.platform.v1")
  assert.equal(files.length, 1, "Platform unique descriptor file required")
  return files[0]
}
function exactDescriptor(schema, actual, expected, reason) {
  assert.ok(actual, reason)
  assert.deepEqual(Buffer.from(toBinary(schema, actual)), Buffer.from(toBinary(schema, fromJson(schema, expected))), reason)
}
function assertWholeParent(set, file) {
  assert.equal(
    sha256(toBinary(FileDescriptorSetSchema, set)),
    publicationInputs[`contract/descriptor/${file}`].sha256,
    `Platform whole parent graph drifted: ${file}`,
  )
}

export function assertV9Proof(manifest) {
  assert.deepEqual(
    manifest,
    {
      artifact: "platform-execution-operations",
      artifactVersion: "9.0.0",
      status: "inactive",
      routable: false,
      packageName: "kokoro.platform.v1",
      inherits: { version: "8.0.0", aggregateSha256: artifactAggregates.v8 },
      counts: { rpc: 43, command: 20, proof: 24 },
      profile: "global-mcp-registration-v1",
    },
    "Platform historical v9 proof drifted",
  )
}

export function assertDescriptorLineage(currentBytes) {
  assert.equal(sha256(currentBytes), descriptorDigest, "Platform descriptor digest drifted")
  const current = fromBinary(FileDescriptorSetSchema, currentBytes)
  assertInspectionDescriptors(current)
  assertDescriptorCensus(current, [63, 32, 24])
  return stripDescriptorLineage(current)
}

export function assertDescriptorCensus(set, expected) {
  const file = createFileRegistry(set).getFile("kokoro/platform/v1/platform_runtime.proto")
  assert.ok(file, "Platform registry missing")
  const inputs = file.services.flatMap((service) => service.methods.map((method) => method.input))
  assert.deepEqual(
    [
      inputs.length,
      inputs.filter((input) => input.fields.some((field) => field.name === "command")).length,
      inputs.filter((input) => input.fields.some((field) => field.name === "execution_proof")).length,
    ],
    expected,
    "Platform RPC/command/proof census drifted",
  )
}

// Independent exact shape assertions are also exported for adversarial contract tests.
export function assertInspectionDescriptors(set) {
  const file = platformFile(set)
  assert.equal(file.service.flatMap((service) => service.method).length, 63, "Platform historical inspection RPC census drifted")
  const messages = [
    ...inspectionReads.map(([, method, id, idType]) => ({
      name: `${method}Request`,
      field: [descriptorField("request_id", 1, 9), descriptorField(id, 2, 11, idType), descriptorField("file_path", 3, 9, undefined, false, true)],
      oneofDecl: [{ name: "_file_path" }],
      reservedRange: [{ start: 100, end: 101 }],
      reservedName: inspectionReserved,
    })),
    ...inspectionReads.map(([, method]) => ({
      name: `${method}Response`,
      field: [
        descriptorField("source_ref", 1, 11, "SkillSourceRef"),
        descriptorField("revision", 2, 4),
        descriptorField("files", 3, 11, "SkillPackageTextFile", true),
        descriptorField("selected_file", 4, 11, "SkillPackageSelectedText"),
      ],
    })),
    { name: "SkillPackageTextFile", field: [descriptorField("path", 1, 9), descriptorField("size_bytes", 2, 4)] },
    { name: "SkillPackageSelectedText", field: [descriptorField("path", 1, 9), descriptorField("text", 2, 9)] },
  ]
  for (const expected of messages) {
    const matches = file.messageType.filter((message) => message.name === expected.name)
    assert.equal(matches.length, 1, `Platform unique ${expected.name}`)
    exactDescriptor(DescriptorProtoSchema, matches[0], expected, `Platform inspection shape drifted: ${expected.name}`)
  }
  for (const [name, method] of inspectionReads) {
    const matches = file.service.filter((service) => service.name === name)
    assert.equal(matches.length, 1, `Platform unique ${name}`)
    exactDescriptor(
      ServiceDescriptorProtoSchema,
      matches[0],
      { name, method: [{ name: method, inputType: `.kokoro.platform.v1.${method}Request`, outputType: `.kokoro.platform.v1.${method}Response` }] },
      `Platform inspection unary service drifted: ${name}`,
    )
  }
}

export function stripDescriptorLineage(set) {
  let current = fromBinary(FileDescriptorSetSchema, toBinary(FileDescriptorSetSchema, set))
  const installationQuery = platformFile(current).messageType.find((message) => message.name === "ListPersonalSkillInstallationsRequest")
  assert.ok(installationQuery, "Platform personal installation list request required")
  exactDescriptor(
    FieldDescriptorProtoSchema,
    installationQuery.field.find((field) => field.number === 6),
    { ...descriptorField("query", 6, 9, undefined, false, true), oneofIndex: 3 },
    "Platform personal optional query tag6 drifted",
  )
  assert.deepEqual(
    installationQuery.oneofDecl.map((entry) => entry.name),
    ["_enabled", "_installed", "_source_kind", "_query"],
    "Platform personal query oneof drifted",
  )
  installationQuery.field = installationQuery.field.filter((field) => field.number !== 6)
  installationQuery.oneofDecl.pop()
  assertWholeParent(current, "platform-skill-personal-query-parent.binpb")
  const provenance = platformFile(current).messageType.find((message) => message.name === "SkillGithubProvenance")
  assert.ok(provenance, "Platform GitHub provenance required")
  const asset = provenance.field.find((field) => field.number === 8)
  exactDescriptor(
    FieldDescriptorProtoSchema,
    asset,
    { ...descriptorField("asset_ref", 8, 9), proto3Optional: true, oneofIndex: 0 },
    "Platform GitHub optional asset tag8 drifted",
  )
  assert.deepEqual(
    provenance.oneofDecl.map((entry) => entry.name),
    ["_asset_ref"],
    "Platform GitHub asset presence oneof drifted",
  )
  delete asset.proto3Optional
  delete asset.oneofIndex
  provenance.oneofDecl = []
  assertWholeParent(current, "platform-skill-github-asset-parent.binpb")
  const productParent = fromBinary(FileDescriptorSetSchema, readFileSync(path.join(root, vendorRoot, "descriptor/platform-skill-product-parent.binpb")))
  const productGenerated = fromBinary(
    FileDescriptorProtoSchema,
    readFileSync(path.join(root, vendorRoot, "descriptor/platform-skill-product-parent-generated.binpb")),
  )
  assert.deepEqual(
    toBinary(FileDescriptorProtoSchema, platformFile(productParent), { writeUnknownFields: false }),
    toBinary(FileDescriptorProtoSchema, productGenerated, { writeUnknownFields: false }),
    "Platform product independent parent drifted",
  )
  current = productParent
  const categoryParent = fromBinary(FileDescriptorSetSchema, readFileSync(path.join(root, vendorRoot, "descriptor/platform-skill-category-keys-parent.binpb")))
  const categoryGenerated = fromBinary(
    FileDescriptorProtoSchema,
    readFileSync(path.join(root, vendorRoot, "descriptor/platform-skill-category-keys-parent-generated.binpb")),
  )
  assert.deepEqual(
    toBinary(FileDescriptorProtoSchema, platformFile(categoryParent), { writeUnknownFields: false }),
    toBinary(FileDescriptorProtoSchema, categoryGenerated, { writeUnknownFields: false }),
    "Platform category independent parent drifted",
  )
  current = categoryParent
  const file = platformFile(current)
  const installation = file.messageType.find((message) => message.name === "ProductSkillInstallation")
  assert.ok(installation)
  const metadata = file.messageType.find((message) => message.name === "SkillMetadata")
  assert.ok(metadata)
  const metadataExamples = metadata.field.filter((field) => field.name === "example_prompts")
  assert.equal(metadataExamples.length, 1, "Platform metadata example prompts unique field drifted")
  exactDescriptor(
    FieldDescriptorProtoSchema,
    metadataExamples[0],
    descriptorField("example_prompts", 5, 11, "SkillExamplePrompts"),
    "Platform metadata example prompts shape drifted",
  )
  const installationExamples = installation.field.filter((field) => field.name === "example_prompts")
  assert.equal(installationExamples.length, 1, "Platform installation example prompts unique field drifted")
  exactDescriptor(
    FieldDescriptorProtoSchema,
    installationExamples[0],
    descriptorField("example_prompts", 15, 11, "SkillExamplePrompts"),
    "Platform installation example prompts shape drifted",
  )
  const exampleMessages = file.messageType.filter((message) => message.name === "SkillExamplePrompts")
  assert.equal(exampleMessages.length, 1, "Platform example prompts unique message drifted")
  exactDescriptor(
    DescriptorProtoSchema,
    exampleMessages[0],
    { name: "SkillExamplePrompts", field: [descriptorField("prompts", 1, 9, undefined, true)] },
    "Platform example prompts message drifted",
  )
  metadata.field = metadata.field.filter((field) => field.name !== "example_prompts")
  installation.field = installation.field.filter((field) => field.name !== "example_prompts")
  file.messageType = file.messageType.filter((message) => message.name !== "SkillExamplePrompts")
  assertWholeParent(current, "platform-skill-example-prompts-parent.binpb")
  const skillUpdatedAt = installation.field.filter((field) => field.name === "skill_updated_at")
  assert.equal(skillUpdatedAt.length, 1, "Platform Skill update instant unique field drifted")
  exactDescriptor(
    FieldDescriptorProtoSchema,
    skillUpdatedAt[0],
    {
      name: "skill_updated_at",
      number: 14,
      type: 11,
      label: 1,
      jsonName: "skillUpdatedAt",
      typeName: ".google.protobuf.Timestamp",
    },
    "Platform Skill update instant shape drifted",
  )
  installation.field = installation.field.filter((field) => field.name !== "skill_updated_at")
  assertWholeParent(current, "platform-skill-updated-at-parent.binpb")
  const additions = inspectionReads
    .flatMap(([, method]) => [`${method}Request`, `${method}Response`])
    .concat(["SkillPackageTextFile", "SkillPackageSelectedText"])
  file.service = file.service.filter((service) => !inspectionReads.some(([name]) => service.name === name))
  file.messageType = file.messageType.filter((message) => !additions.includes(message.name))
  assertWholeParent(current, "platform-package-read-parent.binpb")
  const tags = installation.field.filter((field) => field.name === "tags")
  assert.equal(tags.length, 1, "Platform tags unique field drifted")
  exactDescriptor(FieldDescriptorProtoSchema, tags[0], descriptorField("tags", 13, 9, undefined, true), "Platform tags shape drifted")
  installation.field = installation.field.filter((field) => field.name !== "tags")
  assertWholeParent(current, "platform-installation-tags-parent.binpb")
  const request = file.messageType.find((message) => message.name === "RegisterMcpServerRequest")
  assert.ok(request)
  const registration = request.field.filter((field) => field.name === "registration")
  assert.equal(registration.length, 1, "Platform registration unique field drifted")
  exactDescriptor(
    FieldDescriptorProtoSchema,
    registration[0],
    descriptorField("registration", 8, 11, "McpServerRegistration"),
    "Platform registration shape drifted",
  )
  const definitions = file.messageType.filter((message) => message.name === "McpServerRegistration")
  assert.equal(definitions.length, 1, "Platform registration unique message drifted")
  exactDescriptor(
    DescriptorProtoSchema,
    definitions[0],
    {
      name: "McpServerRegistration",
      field: [
        descriptorField("provider_key", 1, 9),
        descriptorField("server_identity", 2, 9),
        descriptorField("transport", 3, 14, "McpTransport"),
        descriptorField("declaration_digest", 4, 9),
      ],
    },
    "Platform registration definition drifted",
  )
  request.field = request.field.filter((field) => field.name !== "registration")
  file.messageType = file.messageType.filter((message) => message.name !== "McpServerRegistration")
  assertWholeParent(current, "platform-v9-parent43.binpb")
  assertDescriptorCensus(current, [43, 20, 24])
  return current
}

export function assertGeneratedDescriptor(generated, compiledBytes) {
  assert.equal(sha256(compiledBytes), descriptorDigest, "Platform generated compiled pin drifted")
  assert.deepEqual(
    Buffer.from(toBinary(FileDescriptorProtoSchema, generated, { writeUnknownFields: false })),
    Buffer.from(toBinary(FileDescriptorProtoSchema, platformFile(fromBinary(FileDescriptorSetSchema, compiledBytes)), { writeUnknownFields: false })),
    "Platform latest generated/compiled whole graph drifted",
  )
}

export function assertDescriptorPairs(files) {
  for (const httpParent of [
    "platform-skill-updated-at-http-3.3.0.json",
    "platform-skill-example-prompts-http-3.4.0.json",
    "platform-skill-personal-query-parent-http-5.1.0.json",
  ])
    assert.equal(sha256(files[httpParent]), publicationInputs[`contract/descriptor/${httpParent}`].sha256, `Platform HTTP parent bytes drifted: ${httpParent}`)
  for (const stem of [
    "platform-v9-parent43",
    "platform-installation-tags-parent",
    "platform-package-read-parent",
    "platform-skill-updated-at-parent",
    "platform-skill-example-prompts-parent",
    "platform-skill-github-asset-parent",
    "platform-skill-personal-query-parent",
  ]) {
    const compiledName = `${stem}.binpb`
    const generatedName = `${stem}-generated.binpb`
    for (const name of [compiledName, generatedName])
      assert.equal(sha256(files[name]), publicationInputs[`contract/descriptor/${name}`].sha256, `Platform descriptor parent bytes drifted: ${name}`)
    const compiled = platformFile(fromBinary(FileDescriptorSetSchema, files[compiledName]))
    const generated = fromBinary(FileDescriptorProtoSchema, files[generatedName])
    assert.deepEqual(
      Buffer.from(toBinary(FileDescriptorProtoSchema, generated, { writeUnknownFields: false })),
      Buffer.from(toBinary(FileDescriptorProtoSchema, compiled, { writeUnknownFields: false })),
      `Platform parent generated/compiled whole graph drifted: ${stem}`,
    )
  }
}

async function verifyDescriptorPairs() {
  const names = Object.keys(publicationInputs)
    .filter((file) => file.startsWith("contract/descriptor/"))
    .map((file) => path.basename(file))
  assertDescriptorPairs(
    Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(path.join(root, vendorRoot, "descriptor", name))]))),
  )
}

export function assertPublishedDescriptors(currentBytes, parentBytes, files) {
  assert.equal(sha256(currentBytes), "5f0f00f605f6a445b4d80943459b69bf9f489fd7851cc80b6c2700f8f78a8d0e", "Platform descriptor digest drifted")
  assert.equal(sha256(parentBytes), parentDigest, "Platform parent descriptor digest drifted")
  const current = fromBinary(FileDescriptorSetSchema, currentBytes)
  const parent = fromBinary(FileDescriptorSetSchema, parentBytes)
  const currentFile = current.file.find((file) => file.package === "kokoro.platform.v1")
  const parentFile = parent.file.find((file) => file.package === "kokoro.platform.v1")
  assert.ok(currentFile && parentFile, "Platform descriptor file missing")
  assert.equal(currentFile.service.flatMap((service) => service.method).length, 43)
  const methods = ["ListPersonalMcpConnectors", "GetPersonalMcpConnector", "ListPersonalMcpConnections", "GetPersonalMcpConnection"]
  const service = currentFile.service.find((entry) => entry.name === "ProductMcpPersonalService")
  assert.deepEqual(
    service?.method.map((method) => method.name),
    methods,
    "Platform personal methods drifted",
  )
  for (const method of service.method) {
    assert.equal(method.clientStreaming, false)
    assert.equal(method.serverStreaming, false)
  }
  const additions = [
    ...methods.flatMap((method) => [`${method}Request`, `${method}Response`]),
    "PersonalMcpPageRequest",
    "PersonalMcpConnector",
    "PersonalMcpConnection",
  ]
  assert.equal(currentFile.messageType.filter((message) => additions.includes(message.name)).length, 11)
  const catalog = JSON.parse(files["operation-catalog.json"].toString("utf8"))
  assert.deepEqual(
    catalog.operations.filter((entry) => entry.fqMethod === "kokoro.platform.v1.SkillCatalogService/GetSkillPackageUpload"),
    [
      {
        class: "workload-only",
        fqMethod: "kokoro.platform.v1.SkillCatalogService/GetSkillPackageUpload",
        operation: "skill.get_package_upload",
        proof: "forbidden",
        permission: "platform:skill-catalog.manage",
        idempotency: "none",
      },
    ],
    "Platform Get catalog semantics drifted",
  )
  for (const file of [parentFile, currentFile]) {
    const method = file.service.find((entry) => entry.name === "SkillCatalogService")?.method.find((entry) => entry.name === "GetSkillPackageUpload")
    assert.ok(method && !method.clientStreaming && !method.serverStreaming, "Platform Get method drifted")
    assert.equal(method.inputType, ".kokoro.platform.v1.GetSkillPackageUploadRequest")
    assert.equal(method.outputType, ".kokoro.platform.v1.GetSkillPackageUploadResponse")
    const request = file.messageType.find((entry) => entry.name === "GetSkillPackageUploadRequest")
    assert.deepEqual(
      request?.field.map((field) => [field.name, field.number, field.type, field.typeName]),
      [
        ["request_id", 1, 9, ""],
        ["skill_id", 2, 11, ".kokoro.platform.v1.SkillId"],
        ["product_context", 3, 11, ".kokoro.platform.v1.ProductCatalogContext"],
      ],
      "Platform Get request descriptor drifted",
    )
    const response = file.messageType.find((entry) => entry.name === "GetSkillPackageUploadResponse")
    assert.deepEqual(
      response?.field.map((field) => [field.name, field.number, field.type, field.proto3Optional]),
      [
        ["skill_id", 1, 11, false],
        ["attempt_id", 2, 9, true],
        ["attempt_epoch", 3, 4, false],
        ["phase", 4, 14, false],
        ["upload_id", 5, 9, true],
      ],
      "Platform Get response descriptor drifted",
    )
  }
  currentFile.service = currentFile.service.filter((entry) => entry.name !== "ProductMcpPersonalService")
  currentFile.messageType = currentFile.messageType.filter((entry) => !additions.includes(entry.name))
  assert.deepEqual(
    Buffer.from(toBinary(FileDescriptorSetSchema, current)),
    Buffer.from(toBinary(FileDescriptorSetSchema, parent)),
    "Platform parent39 structure drifted",
  )
}

async function verifyExecutionArtifacts() {
  await verifyPublicationInputs()
  const v5 = await verifyExecutionArtifactDirectory(path.join(root, artifacts.v5), artifactAggregates.v5)
  const v6 = await verifyExecutionArtifactDirectory(path.join(root, artifacts.v6), artifactAggregates.v6)
  const v7 = await verifyExecutionArtifactDirectory(path.join(root, artifacts.v7), artifactAggregates.v7)
  const v8 = await verifyExecutionArtifactDirectory(path.join(root, artifacts.v8), artifactAggregates.v8)
  const v9 = await verifyExecutionArtifactDirectory(path.join(root, artifacts.v9), artifactAggregates.v9)
  assertProofChain(v5.manifest, v6.manifest, v7.manifest, v8.manifest)
  assertV9Proof(v9.manifest)
  const exampleProfile = JSON.parse(await readFile(path.join(root, vendorRoot, "execution-operations/skill-example-prompts-v1.json"), "utf8"))
  assert.equal(exampleProfile.artifact, "platform-skill-example-prompts")
  assert.equal(exampleProfile.artifactVersion, "1.0.1")
  assert.equal(exampleProfile.commandDigestVersion, "3.0.0")
  assert.equal(exampleProfile.runtimeActivated, false)
  assert.deepEqual(exampleProfile.counts, { rpc: 45, command: 20, proof: 24 })
  assert.deepEqual(exampleProfile.methods, [
    "kokoro.platform.v1.SkillCatalogService/CreateSkillDraft",
    "kokoro.platform.v1.SkillCatalogService/CreateSkillVersion",
  ])
  assert.equal(exampleProfile.parent.compiledSha256, "fcfab521242b07c17b08efad33463022625fd5163f1e62beb18ddd9589053808")
  assert.equal(exampleProfile.parent.generatedSha256, "e416d960b344797b89418a2534f90c3b6923e9359ad48a6943a11005b9cd9567")
  assert.equal(exampleProfile.parent.httpSha256, "ca90f41f124c53a690746434cb66ac774f4a134acf109decd44bb110fafa61d6")
  assert.equal(exampleProfile.http.version, "3.5.0")
  assert.equal(exampleProfile.wire.metadata.tag, 5)
  assert.equal(exampleProfile.wire.installation.tag, 15)
  assert.equal(exampleProfile.canonical.absent, "omit-key")
  assert.equal(exampleProfile.canonical.present, "unwrap-prompts-array")
  const exampleVectors = JSON.parse(await readFile(path.join(root, vendorRoot, "execution-operations/skill-example-prompts-v1.vectors.json"), "utf8"))
  assert.equal(exampleVectors.artifactVersion, "1.0.1")
  assert.equal(exampleVectors.vectors.length, 64)
  assert.equal(new Set(exampleVectors.vectors.map((entry) => entry.id)).size, 64)
  const registrationVectors = JSON.parse(v9.files["vectors/global-mcp-registration.json"].toString("utf8")).vectors
  assert.equal(registrationVectors.length, 128)
  assert.equal(new Set(registrationVectors.map((entry) => entry.id)).size, 128)
  await verifyDescriptorPairs()
  const personalVectors = JSON.parse(v8.files["vectors/personal-mcp-read.json"].toString("utf8")).vectors
  assert.equal(personalVectors.length, 190)
  assert.equal(new Set(personalVectors.map((entry) => entry.id)).size, 190)
  assertPublishedDescriptors(await readFile(path.join(root, descriptor)), await readFile(path.join(root, parentDescriptor)), v5.files)
  const descriptorTree = await tree(path.join(root, vendorRoot, "descriptor"))
  assert.deepEqual(
    descriptorTree,
    {
      files: Object.keys(publicationInputs)
        .filter((file) => file.startsWith("contract/descriptor/"))
        .map((file) => path.basename(file))
        .sort(),
      directories: [],
    },
    "Platform descriptor tree drifted",
  )
  assertV5Product(v5.files)
  const profile = JSON.parse(v7.files["zip-profile-v2.json"].toString("utf8"))
  assert.deepEqual(profile.manifestKeys, ["schema_version", "entry"], "Platform V2 manifest key set drifted")
  assert.equal(profile.manifestSchemaVersion, 2, "Platform V2 manifest schema drifted")
  assert.equal(profile.manifestEntry, "SKILL.md", "Platform V2 entry drifted")
  assert.equal(profile.manifestIdentity, "zip-v2:sha256:<64 lowercase hex SHA256 of raw decompressed manifest bytes>")
  const vectors = JSON.parse(v7.files["vectors/zip-v2.json"].toString("utf8")).vectors
  assert.match(vectors.find(({ name }) => name === "valid-v2")?.manifestIdentity ?? "", /^zip-v2:sha256:[a-f0-9]{64}$/u)
  assert.equal(vectors.find(({ name }) => name === "legacy-v1-rejected")?.expectedReason, "package_manifest_invalid")
  assert.equal(sha256(await readFile(path.join(root, descriptor))), descriptorDigest, "Platform descriptor digest drifted")
}

async function verifyInputs() {
  await verifyPublicationInputs()
  const provenance = JSON.parse(await readFile(path.join(root, vendorRoot, "provenance.json"), "utf8"))
  assert.equal(provenance.combinedSha256, "6fcc148fddb4aaab73076dfb5b6109e2b4d9f0209e93ef58b0c510e3ed28b693", "Platform active digest drifted")
  assert.equal(
    sha256(Buffer.concat(await Promise.all(provenance.files.map((file) => readFile(path.join(root, vendorRoot, vendorPath(file))))))),
    provenance.combinedSha256,
    "Platform active sources drifted",
  )
  const set = fromBinary(FileDescriptorSetSchema, await readFile(path.join(root, descriptor)))
  const registry = createFileRegistry(set)
  const method = registry.getService("kokoro.platform.v1.ProductSkillReadService").methods.find((method) => method.name === "GetCurrentSkill")
  assert.deepEqual(
    method.input.fields.map((field) => field.name),
    ["request_id", "series_id", "purpose"],
    "Platform current read binding drifted",
  )
  assertVendorPins(await readdir(path.join(root, "contract/vendor/kokoro-platform"), { withFileTypes: true }))
  assertVendorLayout(await readdir(path.join(root, "contract/vendor/kokoro-platform", ownerCommit), { withFileTypes: true }))
  assert.equal(process.versions.node, "22.22.2", "Platform consumer generation requires pinned Node 22.22.2")
  assert.equal(await readFile(path.join(root, ".node-version"), "utf8"), "22.22.2\n")
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
  assert.equal(packageJson.packageManager, "pnpm@11.25.0")
  for (const [name, version] of Object.entries({
    ...versions,
    prettier: "3.9.6",
    typescript: "5.9.3",
  })) {
    assert.equal(packageJson.dependencies[name] ?? packageJson.devDependencies[name], version, `${name} manifest version`)
    const installed = JSON.parse(await readFile(path.join(root, "node_modules", name, "package.json"), "utf8"))
    assert.equal(installed.version, version, `${name} installed version`)
  }
  const sources = await tree(path.join(root, vendor))
  assert.deepEqual(sources.directories, sourceDirectories, "Platform source directory allowlist drifted")
  assertSourceDigests(Object.fromEntries(await Promise.all(sources.files.map(async (file) => [file, await readFile(path.join(root, vendor, file))]))))
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, configFiles[0]), "utf8")),
    { version: "v2", modules: [{ path: vendor }] },
    "Buf input config drifted",
  )
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, configFiles[1]), "utf8")),
    {
      version: "v2",
      plugins: [
        {
          local: "node_modules/.bin/protoc-gen-es",
          out: ".",
          opt: ["target=ts", "import_extension=js"],
        },
      ],
    },
    "Buf generator config drifted",
  )
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    })
    child.once("error", reject)
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}`))))
  })
}

async function generate(directory) {
  await run(path.join(root, "node_modules/.bin/buf"), [
    "generate",
    "--config",
    configFiles[0],
    "--template",
    configFiles[1],
    "--output",
    directory,
    ...generationInputs.flatMap((file) => ["--path", `${vendor}/${file}`]),
  ])
  assertGeneratedTree(await tree(directory))
  await run(process.execPath, [path.join(root, "node_modules/prettier/bin/prettier.cjs"), "--no-semi", "--print-width", "160", "--write", directory])
  await run(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    `
    import { readFile } from "node:fs/promises";
    import { assertGeneratedDescriptor } from ${JSON.stringify(import.meta.url)};
    import { file_kokoro_platform_v1_platform_runtime } from ${JSON.stringify(pathToFileURL(path.join(directory, generatedFiles[1])).href)};
    assertGeneratedDescriptor(file_kokoro_platform_v1_platform_runtime.proto, await readFile(${JSON.stringify(path.join(root, descriptor))}));
  `,
  ])
}

async function manifestFor(directory) {
  return {
    schema_version: 1,
    status: "generated-not-activated",
    owner: {
      repository_path: "apps/kokoro-capability",
      repository_commit: ownerCommit,
      package_name: "kokoro.platform.v1",
      sources: Object.entries(sourceDigests).map(([file, digest]) => ({
        path: `contract/proto/${file}`,
        sha256: digest,
      })),
    },
    published_inputs: {
      path_algorithm: "owner-repository-relative-including-contract",
      aggregate_sha256: publicationAggregate,
      files: Object.entries(publicationInputs).map(([file, pin]) => ({ path: file, ...pin })),
    },
    execution_artifact: {
      path: artifacts.v10,
      artifact_version: "10.0.0",
      status: "inactive",
      routable: false,
      provenance_path: `${artifacts.v10}/provenance.json`,
      aggregate_sha256: artifactAggregates.v10,
    },
    execution_proof_chain: [
      {
        path: artifacts.v10,
        artifact_version: "10.0.0",
        aggregate_sha256: artifactAggregates.v10,
        inherits_version: "9.0.0",
        inherits_aggregate_sha256: artifactAggregates.v9,
      },
      {
        path: artifacts.v9,
        artifact_version: "9.0.0",
        aggregate_sha256: artifactAggregates.v9,
        inherits_version: "8.0.0",
        inherits_aggregate_sha256: artifactAggregates.v8,
      },
      {
        path: artifacts.v8,
        artifact_version: "8.0.0",
        aggregate_sha256: artifactAggregates.v8,
        inherits_version: "7.0.0",
        inherits_aggregate_sha256: artifactAggregates.v7,
      },
      {
        path: artifacts.v7,
        artifact_version: "7.0.0",
        aggregate_sha256: artifactAggregates.v7,
        inherits_version: "6.0.0",
        inherits_aggregate_sha256: artifactAggregates.v6,
      },
      {
        path: artifacts.v6,
        artifact_version: "6.0.0",
        aggregate_sha256: artifactAggregates.v6,
        inherits_version: "5.0.1",
        inherits_aggregate_sha256: artifactAggregates.v5,
      },
      {
        path: artifacts.v5,
        artifact_version: "5.0.1",
        aggregate_sha256: artifactAggregates.v5,
      },
    ],
    descriptor: {
      path: descriptor,
      sha256: descriptorDigest,
    },
    parent_descriptor: { path: parentDescriptor, sha256: parentDigest },
    descriptor_parents: Object.entries(publicationInputs)
      .filter(([file]) => file.startsWith("contract/descriptor/") && file !== "contract/descriptor/platform-v1.binpb")
      .map(([file, pin]) => ({ path: `${vendorRoot}/${vendorPath(file)}`, sha256: pin.sha256 })),
    generator: {
      packages: versions,
      configs: await Promise.all(
        configFiles.map(async (file) => ({
          path: file,
          sha256: sha256(await readFile(path.join(root, file))),
        })),
      ),
      script_sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
      formatting: {
        package: "prettier",
        version: "3.9.6",
        semi: false,
        print_width: 160,
      },
    },
    dependency_decision: {
      verified_on: "2026-10-05",
      approach:
        "Reuse the published owner's exact Buf/Protobuf-ES/Connect versions; no floating upgrade. Protobuf-ES v2 emits service descriptors consumed by Connect createClient.",
      alternatives:
        "Handwritten DTO/RPC serializers duplicate the owner contract; copying owner runtime/generated files lacks an independent reproducible consumer generation chain.",
      licenses: "Buf, Protobuf-ES and Connect-ES: Apache-2.0",
      supply_chain: "Exact package versions and lock integrity; local generation without remote plugins; only @bufbuild/buf install build is newly allowed.",
      performance: "No network calls or application startup added. Runtime performance is unmeasured; this slice validates descriptor serialization only.",
      failure_semantics:
        "Generation rejects source/config/package/tree/digest drift. The fixed V9 to V8 to V7 to V6 to V5 proof chain, descriptor, current Proto source and Get read binding fail closed; runtime adapter admits current user before Platform Connect.",
      exit_path: "Regenerate from the pinned owner Proto with a reviewed compatible generator; generated wire types remain isolated from business code.",
      sources: ["https://connectrpc.com/docs/node/getting-started/", "https://github.com/bufbuild/protobuf-es/releases/tag/v2.14.0"],
    },
    runtime: { node: "22.22.2", pnpm: "11.25.0", typescript: "5.9.3" },
    lockfile_sha256: sha256(await readFile(path.join(root, "pnpm-lock.yaml"))),
    build_policy_sha256: sha256(await readFile(path.join(root, "pnpm-workspace.yaml"))),
    generated: await Promise.all(
      generatedFiles.map(async (file) => ({
        path: file,
        sha256: sha256(await readFile(path.join(directory, file))),
      })),
    ),
  }
}

async function main() {
  const mode = process.argv[2]
  assert.ok(mode === "--write" || mode === "--check", "expected --write or --check")
  await verifyInputs()
  const temporary = await mkdtemp(path.join(tmpdir(), "kokoro-platform-connect-"))
  try {
    // The disposable generated module harness uses the same installed toolchain and ESM semantics.
    await writeFile(path.join(temporary, "package.json"), '{"type":"module"}\n')
    await symlink(path.join(root, "node_modules"), path.join(temporary, "node_modules"), "dir")
    const first = path.join(temporary, "first")
    const second = path.join(temporary, "second")
    await generate(first)
    await generate(second)
    for (const file of generatedFiles)
      assert.deepEqual(await readFile(path.join(first, file)), await readFile(path.join(second, file)), `non-deterministic generation: ${file}`)
    const manifest = await manifestFor(first)
    if (mode === "--write") {
      await rm(output, { recursive: true, force: true })
      await cp(first, output, { recursive: true })
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    } else {
      assertGeneratedTree(await tree(output))
      for (const file of generatedFiles)
        assert.deepEqual(await readFile(path.join(output, file)), await readFile(path.join(first, file)), `generated file drifted: ${file}`)
      assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), manifest, "Platform dependency manifest drifted")
    }
    console.log(
      `PASS Platform Connect ${mode.slice(2)} (${generatedFiles.length} files, two byte-identical generations; formal active publication + exact generated descriptor; runtime acceptance remains separate)`,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
