// Independent W3C XML Schema validation using Java's JAXP Xerces parser.
// No custom subset of MusicXML grammar is used. Data never leaves the
// local process. The only external XSD imports are locally pinned W3C files.
import java.io.File;
import java.io.StringReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import javax.xml.validation.Validator;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;
import javax.xml.transform.dom.DOMSource;

class MusicXmlSchemaValidator {
    private static void require(boolean ok, String message) {
        if (!ok) throw new IllegalArgumentException(message);
    }

    private static Document parse(File input) throws Exception {
        byte[] raw=Files.readAllBytes(input.toPath());
        require(raw.length>0 && raw.length<=8*1024*1024,
                "MusicXML file size limit exceeded: "+input.getName());
        String text=new String(raw,java.nio.charset.StandardCharsets.UTF_8);
        require(!text.matches("(?is).*<!ENTITY\\b.*"),
                "Entity declaration is forbidden: "+input.getName());
        DocumentBuilderFactory factory=DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setValidating(false);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING,true);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd",false);
        factory.setFeature("http://xml.org/sax/features/external-general-entities",false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities",false);
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD,"");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA,"");
        DocumentBuilder builder=factory.newDocumentBuilder();
        builder.setEntityResolver((publicId,systemId)->new InputSource(new StringReader("")));
        Document document=builder.parse(input);
        Element root=document.getDocumentElement();
        require(root!=null && "score-partwise".equals(root.getTagName()) &&
          "4.0".equals(root.getAttribute("version")),
          "Requires MusicXML 4.0 score-partwise: "+input.getName());
        return document;
    }

    private static void valid(Schema schema,Document document) throws Exception {
        Validator validator=schema.newValidator();
        validator.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD,"");
        validator.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA,"");
        validator.validate(new DOMSource(document));
    }

    public static void main(String[] args) throws Exception {
        require(args.length>=2 && args.length<=250,
                "Usage: java MusicXmlSchemaValidator.java schema.xsd score1.musicxml ...");
        Path schemaFile=Path.of(args[0]).toAbsolutePath();
        require(Files.isRegularFile(schemaFile),"Pinned schema is missing");
        SchemaFactory factory=SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING,true);
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD,"");
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA,"file");
        Schema schema=factory.newSchema(schemaFile.toFile());
        int passed=0;
        for(String name:Arrays.copyOfRange(args,1,args.length)){
            File file=Path.of(name).toAbsolutePath().toFile();
            try {
                valid(schema,parse(file));
                passed++;
            }catch(Exception error){
                System.err.println("MUSICXML_4_XSD_FAILED="+file.getName()+" "+error.getMessage());
                throw error;
            }
        }
        // Independent negative controls ensure the schema is actually used.
        File first=Path.of(args[1]).toAbsolutePath().toFile();
        Document broken=parse(first);
        org.w3c.dom.Node partList=broken.getElementsByTagName("part-list").item(0);
        require(partList!=null,"Negative-control score must contain a part-list");
        partList.getParentNode().removeChild(partList);
        boolean caught=false;
        try {valid(schema,broken);}catch(SAXException error){caught=true;}
        require(caught,"XSD validator accepted a missing required part-list");
        Document unexpected=parse(first);
        Element unknown=unexpected.createElement("not-in-musicxml");
        unexpected.getDocumentElement().insertBefore(unknown,unexpected.getDocumentElement().getFirstChild());
        caught=false;
        try {valid(schema,unexpected);}catch(SAXException error){caught=true;}
        require(caught,"XSD validator accepted an unknown element");
        System.out.println("MUSICXML_4_XSD=PASS cases="+passed+" negatives=2 internet=disabled");
    }
}
