import com.sap.gateway.ip.core.customdev.util.Message

/**
 * Script: ExtractSalesOrderNumber.groovy
 *
 * Purpose: After JSON->XML conversion, extract the SalesOrder number
 * and store it as an exchange property for the OData query step.
 *
 * Expected XML structure after JSON-to-XML conversion:
 * <SalesOrderNotification>
 *   <salesOrderId>0000004711</salesOrderId>    <!-- primary field -->
 *   <SalesOrder>0000004711</SalesOrder>         <!-- alternate field name -->
 *   <VBELN>0000004711</VBELN>                   <!-- SAP field name -->
 *   <orderNumber>0000004711</orderNumber>        <!-- another common name -->
 * </SalesOrderNotification>
 */
def Message processData(Message msg) {

    def bodyStr = msg.getBody(String)

    if (!bodyStr) {
        throw new Exception("Empty message body — cannot extract SalesOrder number")
    }

    def xml
    try {
        xml = new XmlSlurper().parseText(bodyStr)
    } catch (Exception e) {
        throw new Exception("Failed to parse XML body: ${e.message}. Body was: ${bodyStr.take(200)}")
    }

    // Try multiple field names — handle whatever the S/4 system sends
    def salesOrderId =
        xml.salesOrderId?.text()?.trim()  ?:
        xml.SalesOrder?.text()?.trim()    ?:
        xml.VBELN?.text()?.trim()         ?:
        xml.orderNumber?.text()?.trim()   ?:
        xml.SalesOrderID?.text()?.trim()  ?:
        xml.orderId?.text()?.trim()       ?:
        null

    if (!salesOrderId) {
        throw new Exception(
            "SalesOrder number not found in XML. " +
            "Expected one of: salesOrderId, SalesOrder, VBELN, orderNumber. " +
            "Received XML root children: ${xml.children()*.name().join(', ')}"
        )
    }

    // Zero-pad to 10 digits (SAP VBELN format)
    def paddedId = salesOrderId.padLeft(10, '0')

    msg.setProperty("salesOrderId",        paddedId)
    msg.setProperty("salesOrderIdRaw",     salesOrderId)
    msg.setProperty("salesOrderIdDisplay", salesOrderId.replaceAll(/^0+/, '') ?: '0')

    return msg
}
