import AdmZip from 'adm-zip';

export const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
/** Synthetic customer-free OOXML with deliberately nontrivial index/structure order. */
export function pictureInCellFixture(
  options: {
    media?: Buffer;
    web?: boolean;
    missing?: boolean;
    invalid?: boolean;
    invalidType?: boolean;
    nonImage?: boolean;
    cells?: string[];
    mixed?: boolean;
    external?: boolean;
  } = {},
) {
  const zip = new AdmZip();
  const add = (p: string, xml: string) => zip.addFile(p, Buffer.from(xml));
  add(
    'xl/workbook.xml',
    '<workbook><sheets><sheet name="Cover" r:id="cover"/><sheet name="Styles" r:id="sheet"/></sheets></workbook>',
  );
  add(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="cover" Type="x/worksheet" Target="worksheets/cover.xml"/><Relationship Id="sheet" Type="x/worksheet" Target="worksheets/styles.xml"/><Relationship Id="meta" Type="x/sheetMetadata" Target="metadata.xml"/><Relationship Id="rv" Type="x/rdRichValue" Target="richData/rdrichvalue.xml"/><Relationship Id="s" Type="x/rdRichValueStructure" Target="richData/rdrichvaluestructure.xml"/><Relationship Id="rel" Type="x/richValueRel" Target="richData/richValueRel.xml"/><Relationship Id="web" Type="x/rdRichValueWebImage" Target="richData/rdRichValueWebImage.xml"/></Relationships>',
  );
  add('xl/worksheets/cover.xml', '<worksheet/>');
  add(
    'xl/worksheets/styles.xml',
    `<worksheet><sheetData>${(options.cells ?? ['D7']).map((cell) => `<row><c r="${cell}" vm="${options.invalid ? 9 : 1}" t="e"><v>#VALUE!</v></c></row>`).join('')}</sheetData>${options.mixed ? '<drawing r:id="drawing"/>' : ''}</worksheet>`,
  );
  add(
    'xl/metadata.xml',
    `<metadata><metadataTypes><metadataType name="OTHER"/><metadataType name="XLRICHVALUE"/></metadataTypes><futureMetadata name="OTHER"><bk/></futureMetadata><futureMetadata name="XLRICHVALUE"><bk/><bk><extLst><ext><rd:rvb i="0"/></ext></extLst></bk></futureMetadata><valueMetadata><bk><rc t="${options.invalidType ? 9 : 2}" v="1"/></bk></valueMetadata></metadata>`,
  );
  add(
    'xl/richData/rdrichvalue.xml',
    `<rvData><rv s="${options.nonImage ? 0 : 1}"><v>5</v><v>0</v></rv></rvData>`,
  );
  add(
    'xl/richData/rdrichvaluestructure.xml',
    `<rvStructures><s t="unused"/><s t="${options.web ? '_webimage' : '_localImage'}"><k n="CalcOrigin"/><k n="${options.web ? 'WebImageIdentifier' : '_rvRel:LocalImageIdentifier'}"/></s></rvStructures>`,
  );
  add('xl/richData/richValueRel.xml', '<richValueRels><rel r:id="image"/></richValueRels>');
  add(
    'xl/richData/rdRichValueWebImage.xml',
    '<webImagesSrd><webImageSrd><address r:id="address"/><blip r:id="image"/></webImageSrd></webImagesSrd>',
  );
  for (const name of ['richValueRel', 'rdRichValueWebImage'])
    add(
      `xl/richData/_rels/${name}.xml.rels`,
      `<Relationships><Relationship Id="address" Type="x/hyperlink" Target="https://example.invalid/private.png" TargetMode="External"/><Relationship Id="image" Type="x/image" Target="../media/image.png" ${options.external ? 'TargetMode="External"' : ''}/></Relationships>`,
    );
  if (!options.missing) zip.addFile('xl/media/image.png', options.media ?? tinyPng);
  if (options.mixed) {
    add(
      'xl/worksheets/_rels/styles.xml.rels',
      '<Relationships><Relationship Id="drawing" Type="x/drawing" Target="../drawings/drawing.xml"/></Relationships>',
    );
    add(
      'xl/drawings/drawing.xml',
      '<xdr:wsDr><xdr:oneCellAnchor><xdr:from><xdr:row>6</xdr:row><xdr:col>3</xdr:col></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="image"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor></xdr:wsDr>',
    );
    add(
      'xl/drawings/_rels/drawing.xml.rels',
      '<Relationships><Relationship Id="image" Type="x/image" Target="../media/image.png"/></Relationships>',
    );
  }
  return zip.toBuffer();
}
