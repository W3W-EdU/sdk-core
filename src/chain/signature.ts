import {ABIDecoder} from '../serializer/decoder'
import {ABIEncoder} from '../serializer/encoder'
import {ABISerializableObject} from '../serializer/serializable'

import {Base58} from '../base58'
import {Bytes, BytesType} from './bytes'
import {Checksum256, ChecksumType} from './checksum'
import {PublicKey} from './public-key'

import {recover} from '../crypto/recover'
import {verify} from '../crypto/verify'

export type SignatureType =
    | Signature
    | string
    | {type: string; r: Uint8Array; s: Uint8Array; recid: number}

export class Signature implements ABISerializableObject {
    static abiName = 'signature'

    /** Type, e.g. `K1` */
    type: string
    /** Signature data. */
    data: Bytes

    /** Create Signature object from representing types. */
    static from(value: SignatureType) {
        if (value instanceof Signature) {
            return value
        }
        if (typeof value === 'object') {
            const data = new Uint8Array(1 + 32 + 32)
            let recid = value.recid
            if (value.type === 'K1' || value.type === 'R1') {
                recid += 31
            }
            data[0] = recid
            data.set(value.r, 1)
            data.set(value.s, 33)
            return new Signature(value.type, new Bytes(data))
        }
        if (value.startsWith('SIG_')) {
            const parts = value.split('_')
            if (parts.length !== 3) {
                throw new Error('Invalid signature string')
            }
            const type = parts[1]
            const size = type === 'K1' || type === 'R1' ? 65 : undefined
            const data = Base58.decodeRipemd160Check(parts[2], size, type)
            return new Signature(type, data)
        } else {
            throw new Error('Invalid signature string')
        }
    }

    /** @internal */
    static fromABI(decoder: ABIDecoder) {
        const typeIdx = decoder.readByte()
        let type: string
        switch (typeIdx) {
            case 0:
                type = 'K1'
                break
            case 1:
                type = 'R1'
                break
            case 2: {
                // same as with public keys WA type has some extra data tacked on
                const data = new Bytes(decoder.readArray(65)) // sig
                Bytes.fromABI(decoder) // throw away for now
                Bytes.fromABI(decoder)
                return new Signature('WA', data)
            }
            default:
                throw new Error(`Unknown signature type: ${typeIdx}`)
        }
        return new Signature(type, new Bytes(decoder.readArray(65)))
    }

    /** @internal */
    constructor(type: string, data: Bytes) {
        this.type = type
        this.data = data
    }

    /** Recover public key from given message digest. */
    recoverDigest(digest: ChecksumType) {
        digest = Checksum256.from(digest)
        const compressed = recover(this.data.array, digest.array, this.type)
        return PublicKey.from({compressed, type: this.type})
    }

    /** Recover public key from given message. */
    recoverMessage(message: BytesType) {
        return this.recoverDigest(Bytes.from(message).sha256Digest)
    }

    /** Verify this signature with given message digest and public key. */
    verifyDigest(digest: ChecksumType, publicKey: PublicKey) {
        digest = Checksum256.from(digest)
        return verify(this.data.array, digest.array, publicKey.data.array, this.type)
    }

    /** Verify this signature with given message and public key. */
    verifyMessage(message: BytesType, publicKey: PublicKey) {
        return this.verifyDigest(Bytes.from(message).sha256Digest, publicKey)
    }

    /** Base58check encoded string representation of this signature (`SIG_<type>_<data>`). */
    toString() {
        return `SIG_${this.type}_${Base58.encodeRipemd160Check(this.data, this.type)}`
    }

    /** @internal */
    toABI(encoder: ABIEncoder) {
        switch (this.type) {
            case 'K1':
                encoder.writeByte(0)
                break
            case 'R1':
                encoder.writeByte(1)
                break
            case 'WA':
                encoder.writeByte(2)
                // TODO: this isn't actually supported yet since we threw away the metadata when decoding
                throw new Error('WA keys are not supported yet')
            default:
                throw new Error(`Unable to encode unknown signature type: ${this.type}`)
        }
        encoder.writeArray(this.data.array)
    }

    /** @internal */
    toJSON() {
        return this.toString()
    }
}
