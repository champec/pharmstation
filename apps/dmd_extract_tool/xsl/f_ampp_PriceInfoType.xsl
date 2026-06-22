<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
xmlns:fo="http://www.w3.org/1999/XSL/Format">
<xsl:output method="text" encoding="ASCII" />

<xsl:param name="delimiter" select=" '|' "/>

<xsl:template match="/*">
<xsl:apply-templates/>
</xsl:template>

<?ampp_PriceInfoType?>
<xsl:template match="//PRICE_INFO">
<xsl:value-of select="APPID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="PRICE"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="PRICEDT"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="PRICE_PREV"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="PRICE_BASISCD"/>

<xsl:text>&#xa;</xsl:text>
</xsl:template>
<xsl:template match="text()" />

</xsl:stylesheet>
