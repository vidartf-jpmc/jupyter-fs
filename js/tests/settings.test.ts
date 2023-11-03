import "isomorphic-fetch";

import { unpartialResource } from "../src/settings";
import { IFSSettingsResource } from "../src/filesystem";

describe("unpartialResource", () => {

    it("should replace non-existing fields with empty string", () => {

        // blank resource missing name and url (like after pressing "add")
        let resource: IFSSettingsResource = {auth: "ask", defaultWritable: true};
        let unpartialed = unpartialResource(resource);

        expect(unpartialed.name).toEqual("")
        expect(unpartialed.url).toEqual("")
    })
})