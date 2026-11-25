import Foundation

/// Generated OpenAPI types in, `Remote*` out — the only file in the app that
/// knows the generated types exist, so a spec change becomes a compile error
/// here. The cost is the extra hop; the payoff is that stubs stay two lines and
/// the bundled fixture stays valid test input.
///
/// Dates arrive already decoded: the generator's transcoder handles
/// `format: date-time` fields, so `RemoteOrg.makeDecoder()` is not involved.

extension RemoteIdentity {
    init(_ generated: Components.Schemas.Identity) {
        self.init(userId: generated.userId, orgId: generated.orgId)
    }
}

extension RemoteClientSupport {
    init(_ generated: Components.Schemas.ClientSupport) {
        self.init(
            // An unfamiliar verdict walls nothing; a build that is truly too old
            // still meets the 426.
            updateRequirement: UpdateRequirement(rawValue: generated.updateRequirement) ?? .none,
            updateUrl: URL(string: generated.updateUrl)
        )
    }
}

extension RemoteLocation {
    init(_ generated: Components.Schemas.Location) {
        self.init(
            id: generated.id,
            name: generated.name,
            address: PostalAddress(generated.address),
            contact: ContactInfo(generated.contact),
            commission: Commission(generated.commission),
            notes: generated.notes,
            active: generated.active,
            // Not on the REST surface at all — the Remote struct declares it
            // optional for the local SwiftData model's sake, not the wire shape.
            deletedAt: nil,
            updatedAt: generated.updatedAt
        )
    }
}

extension PostalAddress {
    init(_ generated: Components.Schemas.Location.addressPayload) {
        self.init(
            line1: generated.line1,
            city: generated.city,
            state: generated.state,
            zip: generated.zip,
            geo: generated.geo.map { GeoPoint(lat: $0.lat, lng: $0.lng) }
        )
    }
}

extension ContactInfo {
    init(_ generated: Components.Schemas.Location.contactPayload) {
        self.init(name: generated.name, phone: generated.phone, email: generated.email)
    }
}

extension Commission {
    /// The document serves commission flat with an open `type`, so a new arm
    /// arrives here as an unfamiliar string instead of failing the refresh.
    init(_ generated: Components.Schemas.LocationCommission) {
        self.init(
            type: generated._type,
            percentBps: generated.percentBps,
            flatCents: generated.flatCents,
            basis: generated.basis
        )
    }
}

extension RemoteMachine {
    init(_ generated: Components.Schemas.Machine) {
        self.init(
            id: generated.id,
            locationId: generated.locationId,
            name: generated.name,
            kind: generated.kind,
            make: generated.make,
            model: generated.model,
            serial: generated.serial,
            tagCode: generated.tagCode,
            slots: generated.slots,
            cardReader: generated.cardReader.map {
                CardReader(provider: $0.provider, deviceId: $0.deviceId)
            },
            active: generated.active,
            deletedAt: nil,
            updatedAt: generated.updatedAt
        )
    }
}

extension RemoteProduct {
    init(_ generated: Components.Schemas.Product) {
        self.init(
            id: generated.id,
            name: generated.name,
            upc: generated.upc,
            category: generated.category,
            taxClass: generated.taxClass,
            imageUrl: generated.imageUrl,
            defaultPriceCents: generated.defaultPriceCents,
            active: generated.active,
            // tracksExpiration is on the generated Product but not on
            // RemoteProduct — deliberately unmapped, not an oversight.
            deletedAt: nil,
            updatedAt: generated.updatedAt
        )
    }
}

extension RemotePack {
    init(_ generated: Components.Schemas.Pack) {
        self.init(
            id: generated.id,
            name: generated.name,
            barcodes: generated.barcodes,
            contents: generated.contents.map {
                PackContent(productId: $0.productId, units: $0.units)
            },
            active: generated.active,
            deletedAt: nil,
            updatedAt: generated.updatedAt
        )
    }
}

extension RemotePlanogram {
    init(_ generated: Components.Schemas.Planogram) {
        self.init(
            id: generated.id,
            machineId: generated.machineId,
            effectiveFrom: generated.effectiveFrom,
            slots: generated.slots.map {
                PlanogramSlot(
                    slotCode: $0.slotCode,
                    productId: $0.productId,
                    par: $0.par,
                    priceCents: $0.priceCents
                )
            },
            deletedAt: nil,
            updatedAt: generated.updatedAt
        )
    }
}

extension RemoteCandidate {
    /// The response body is `null` for an unrecognized code; the generated
    /// optional payload already carries that, so the one case worth mapping
    /// is the object itself — `fetchBarcodeCandidate` maps the `nil` case.
    init(_ generated: Operations.getBarcodeCandidate.Output.Ok.Body.jsonPayload) {
        self.init(name: generated.name, brand: generated.brand, imageUrl: generated.imageUrl)
    }
}

extension Operations.createProduct.Input.Body.jsonPayload {
    init(_ draft: RemoteProductDraft) {
        self.init(
            name: draft.name,
            upc: draft.upc,
            category: draft.category,
            taxClass: draft.taxClass,
            imageUrl: draft.imageUrl,
            defaultPriceCents: draft.defaultPriceCents
        )
    }
}

extension Operations.createPack.Input.Body.jsonPayload {
    init(_ draft: RemotePackDraft) {
        self.init(
            name: draft.name,
            barcodes: draft.barcodes,
            contents: draft.contents.map { .init(productId: $0.productId, units: $0.units) }
        )
    }
}

extension RemoteVisit {
    init(_ generated: Components.Schemas.Visit) {
        self.init(
            id: generated.id,
            machineId: generated.machineId,
            countedAt: generated.countedAt,
            lines: generated.lines.map {
                VisitLine(
                    slotCode: $0.slotCode,
                    productId: $0.productId,
                    remaining: $0.remaining,
                    added: $0.added,
                    removed: $0.removed
                )
            }
        )
    }
}
